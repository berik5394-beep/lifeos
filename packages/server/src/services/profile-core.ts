/**
 * Phase 6 C2 — ЧИСТОЕ ядро синтеза профиля (без БД/AI/сети).
 *
 * Решения (спека + возражения): синтез ДОРОГОЙ (Sonnet) → строгий
 * cadence/active-gate ДО любого Claude-вызова. parseProfile —
 * защитный разбор вывода Sonnet: мусор НЕ персистим (честность —
 * лучше пустой/старый профиль, чем выдуманный).
 *
 * UserProfile = производная вьюха над Memory (#4 SSOT). Эти функции
 * не знают про БД — только решают «надо ли» и «валиден ли вывод».
 */

const WEEK_MS = 7 * 86_400_000;
/** Активный = ≥10 взаимодействий/неделю (cost-control, спека). */
const MIN_INTERACTIONS_7D = 10;
/** Защита от prompt-bloat: кап на размеры. */
const MAX_LIST = 20;
const MAX_REL = 30;

export interface SynthGate {
  lastSynthesizedAt: Date | null;
  now: Date;
  /** ChatMessage за 7д (УЖЕ crisis=false — фильтрует glue, C1(d)). */
  interactions7d: number;
  /** Есть ли новые релевантные данные с lastSynthesizedAt. */
  newDataSince: boolean;
}

/**
 * Запускать ли синтез. Порядок дешёвых отсечек до Claude:
 *  - неактивен (<10/нед) → нет (не жжём деньги на «спящих»);
 *  - ни разу не синтезирован И активен → да;
 *  - < недели с прошлого → нет (каденс раз/неделю);
 *  - нет новых данных → нет (нечего пересинтезировать);
 *  - иначе → да.
 */
export function shouldSynthesize(g: SynthGate): boolean {
  if (g.interactions7d < MIN_INTERACTIONS_7D) return false;
  if (g.lastSynthesizedAt === null) return true;
  if (g.now.getTime() - g.lastSynthesizedAt.getTime() < WEEK_MS) {
    return false;
  }
  return g.newDataSince;
}

export interface SynthProfile {
  values: string[];
  triggers: string[];
  patterns: string[];
  styleNotes: string | null;
  relationships: Record<string, string>;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_LIST);
}

function relMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_REL) break;
    if (typeof val === 'string' && k.trim() && val.trim()) {
      out[k.trim()] = val.trim();
      n++;
    }
  }
  return out;
}

/**
 * Защитный разбор вывода Sonnet. Невалидный JSON / не-объект →
 * null (НЕ персистим мусор — честность класса bug #1). Частично
 * валидный объект → нормализуем (отсутствующее = пусто), это ок:
 * лучше частичный честный профиль, чем отказ.
 */
export function parseProfile(raw: string): SynthProfile | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    // иногда модель оборачивает в ```json … ``` — снимем и повторим
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const styleNotes =
    typeof o.styleNotes === 'string' && o.styleNotes.trim()
      ? o.styleNotes.trim().slice(0, 500)
      : null;
  return {
    values: strList(o.values),
    triggers: strList(o.triggers),
    patterns: strList(o.patterns),
    styleNotes,
    relationships: relMap(o.relationships),
  };
}
