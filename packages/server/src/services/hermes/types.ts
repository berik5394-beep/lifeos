/**
 * v2.0 Phase B4 — Hermes composable skills: types + pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b4-hermes-design.md
 *
 * A skill is DATA (plan over EXISTING tools + synthesis). Pure helpers
 * are exported for unit testing without DB/Claude/Voyage.
 */

export interface SkillStep {
  toolName: string;
  argTemplate?: Record<string, unknown>;
}

export interface SkillSpec {
  name: string;
  description: string;
  triggers: string[];
  plan: SkillStep[];
  synthesis: string;
}

export const MAX_STEPS = 8;

/** Capabilities a skill may NOT compose (Berik: всё кроме питомца и фото). */
export const BLOCKLIST = {
  categories: new Set<string>(['pet', 'photo_calorie']),
  toolNames: new Set<string>(),
};

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

/**
 * Validate a plan against the live registry + blocklist. Throws
 * SkillValidationError on: empty, > MAX_STEPS, unknown tool, blocklisted
 * category/name, or a skill referencing another skill (skill_* prefix).
 */
export function validateSkillTools(
  plan: SkillStep[],
  knownToolNames: ReadonlySet<string>,
  categoryOf: (toolName: string) => string,
): void {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new SkillValidationError('План навыка пуст.');
  }
  if (plan.length > MAX_STEPS) {
    throw new SkillValidationError(`Слишком много шагов (> ${MAX_STEPS}).`);
  }
  for (const step of plan) {
    const n = step?.toolName;
    if (typeof n !== 'string' || n.length === 0) {
      throw new SkillValidationError('Шаг без toolName.');
    }
    if (n.startsWith('skill_')) {
      throw new SkillValidationError('Навык не может вызывать другой навык.');
    }
    if (BLOCKLIST.toolNames.has(n)) {
      throw new SkillValidationError(`Инструмент ${n} запрещён в навыках.`);
    }
    if (!knownToolNames.has(n)) {
      throw new SkillValidationError(`Неизвестный инструмент: ${n}.`);
    }
    if (BLOCKLIST.categories.has(categoryOf(n))) {
      throw new SkillValidationError(`Инструмент ${n} в запрещённой категории.`);
    }
  }
}

/** Defensive parser for the haiku-drafted skill spec. Never throws —
 *  returns null on any malformed / incomplete input. */
export function parseSkillSpec(raw: string): SkillSpec | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.description !== 'string') return null;
  if (typeof o.synthesis !== 'string') return null;
  if (!Array.isArray(o.plan) || o.plan.length === 0) return null;
  const plan: SkillStep[] = [];
  for (const s of o.plan) {
    if (!s || typeof s !== 'object') return null;
    const tn = (s as Record<string, unknown>).toolName;
    if (typeof tn !== 'string') return null;
    const step: SkillStep = { toolName: tn };
    const at = (s as Record<string, unknown>).argTemplate;
    if (at && typeof at === 'object') step.argTemplate = at as Record<string, unknown>;
    plan.push(step);
  }
  const triggers = Array.isArray(o.triggers)
    ? o.triggers.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    name: o.name.slice(0, 80),
    description: o.description.slice(0, 280),
    triggers,
    plan,
    synthesis: o.synthesis.slice(0, 1000),
  };
}

/**
 * Render a skill into a seeded instruction appended to the system prompt.
 * The EXISTING agent loop executes it — so write/money steps still hit
 * their own confirm gates (we only remind the model to respect them).
 */
export function buildSkillInstruction(spec: SkillSpec): string {
  const steps = spec.plan
    .map((s, i) => `${i + 1}. ${s.toolName}`)
    .join(' → ');
  return [
    `Пользователь запустил навык «${spec.name}».`,
    `План: ${steps}.`,
    `Затем: ${spec.synthesis}`,
    `Соблюдай обычные правила подтверждения (read — сразу; деньги/запись — спрашивай подтверждение как всегда).`,
  ].join('\n');
}
