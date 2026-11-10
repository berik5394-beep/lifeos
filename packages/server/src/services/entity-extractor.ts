/**
 * v2.0 Tier 3 — EntityExtractor: Claude-based entity + relationship extraction.
 *
 * Takes free text (chat message, dictation transcript) and returns:
 *   - entities detected (name, type, optional attributes)
 *   - relationships between detected entities
 *
 * Pattern mirrors extractFromTranscript in dictation-service.ts:
 *   - Single Claude call with JSON-only system prompt
 *   - Best-effort: failure → return empty arrays (never throws)
 *   - MODELS.haiku (fast, cheap — extraction is a batch classify task)
 *
 * Pure helpers (normalizeEntityName, parseExtractorResponse) are exported
 * separately for unit testing without DB/Claude.
 */

import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEntityInput {
  /** Raw name from text — will be normalized by caller via upsertEntity. */
  name: string;
  /** 'person' | 'place' | 'concept' | 'goal' | 'organization' */
  type: string;
  /** Optional free-form attributes extracted from context. */
  attributes?: Record<string, unknown>;
  /** 1-10 importance signal from extraction context. Default 5. */
  importance?: number;
  /** Известные НЕ-морфологические варианты имени (Серёга↔Сергей, Kaspi↔Каспи). Стеммер морфологию ловит сам. */
  aliases?: string[];
  /**
   * Ключи attributes, о которых пользователь ПРЯМО сказал «изменилось»
   * («мама переехала в Астану» → ["город"]). Только для них фоновая запись
   * заменяет прежнее значение (прежнее уходит в историю).
   */
  changed?: string[];
}

export interface ExtractedRelationshipInput {
  /** Name of the "from" entity (matches entities[] name). */
  fromName: string;
  /** Name of the "to" entity (matches entities[] name). */
  toName: string;
  /**
   * Relationship type: 'family'|'friend'|'colleague'|'partner'|
   * 'concern'|'goal_link'|'location'|'works_at'|'lives_in'|'connected_to'
   */
  type: string;
  /** Optional free-form label. */
  label?: string;
  /** 0..1 estimated relationship strength. Default 0.5. */
  strength?: number;
}

export interface ExtractorResult {
  entities: ExtractedEntityInput[];
  relationships: ExtractedRelationshipInput[];
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB/Claude)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw entity name from Claude extraction:
 *   - trim leading/trailing whitespace
 *   - collapse internal whitespace to single space
 *   - capitalize first letter
 *
 * Examples: "  мама  " → "Мама", "Серик   Жумабаев" → "Серик Жумабаев"
 */
export function normalizeEntityName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Parse Claude JSON response into ExtractorResult.
 * Handles:
 *   - Markdown code fences (```json ... ```)
 *   - Missing keys → empty arrays
 *   - Non-array values → empty arrays
 *   - Invalid JSON → empty arrays (log warn, never throw)
 */
/**
 * Self-reference detector — `true` if `name` refers to the user themselves
 * ("я", "пользователь", "юзер", "user", "себя", own first name).
 *
 * Why: extractor often returns the user as a `person` entity ("Я раздражён"
 * → entity "Я"). Storing this creates duplicates ("Я" / "Берик" / "Пользователь"
 * — three entities for the same person) and pollutes graph queries. We're
 * the user; we already know our own context. Skip self-references.
 *
 * Pure helper (testable). Called before `upsertEntity`.
 */
export function isSelfReference(name: string, userName?: string): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  const SELF = new Set([
    'я', 'мне', 'меня', 'мной', 'мною', 'себя', 'себе',
    'пользователь', 'юзер', 'user', 'i', 'me', 'myself',
  ]);
  if (SELF.has(n)) return true;
  if (userName) {
    const u = userName.trim().toLowerCase();
    if (u && n === u) return true;
  }
  return false;
}

/**
 * Местоимение / «кто-то» вместо имени (2026-11-10): «Вдруг он откажет» →
 * экстрактор вернул человека «Он» и связь «Он → Отказ», в памяти появились
 * «люди» «Он» и «Отказ». Местоимение — не сущность: о ком оно, из одной
 * фразы не понять. Чистая.
 */
const PRONOUNS = new Set([
  'он', 'она', 'оно', 'они', 'его', 'её', 'ее', 'ему', 'ей', 'им', 'их', 'ими',
  'него', 'неё', 'нее', 'нему', 'ней', 'ним', 'них', 'ними', 'нём', 'нем',
  'мы', 'нас', 'нам', 'нами', 'ты', 'тебя', 'тебе', 'тобой', 'вы', 'вас', 'вам', 'вами',
  'кто', 'кто-то', 'кто-нибудь', 'никто', 'некто', 'кое-кто', 'все', 'всё', 'каждый',
  'тот', 'та', 'то', 'те', 'этот', 'эта', 'это', 'эти', 'такой', 'такая', 'сам', 'сама', 'сами',
  'he', 'she', 'it', 'they', 'him', 'her', 'them', 'we', 'you', 'someone', 'somebody',
]);
export function isPronounName(name: string): boolean {
  return PRONOUNS.has(name.trim().toLowerCase().replace(/[.,!?…]+$/, ''));
}

/**
 * Связи — только между сущностями, которые реально извлечены и прошли
 * фильтры. Раньше конец связи без своей сущности заводился как person —
 * так абстракция «Отказ» стала «человеком». Чистая.
 */
export function keepResolvableRelationships(
  entities: ExtractedEntityInput[],
  relationships: ExtractedRelationshipInput[],
): ExtractedRelationshipInput[] {
  const names = new Set(entities.map((e) => e.name));
  return relationships.filter((r) => names.has(r.fromName) && names.has(r.toName) && r.fromName !== r.toName);
}

export function parseExtractorResponse(raw: string): ExtractorResult {
  const empty: ExtractorResult = { entities: [], relationships: [] };
  if (!raw || !raw.trim()) return empty;

  let text = raw.trim();
  // Strip markdown code fences (same pattern as dictation-service.ts).
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const entities = Array.isArray(parsed.entities)
      ? (parsed.entities as ExtractedEntityInput[])
      : [];
    const relationships = Array.isArray(parsed.relationships)
      ? (parsed.relationships as ExtractedRelationshipInput[])
      : [];
    return { entities, relationships };
  } catch (err) {
    console.warn('[entity-extractor] JSON parse failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Async API (Claude call — implemented in Task C2)
// ---------------------------------------------------------------------------

const anthropic = createAnthropic();

const ENTITY_TYPES = ['person', 'place', 'concept', 'goal', 'organization'] as const;
const RELATIONSHIP_TYPES = [
  'family', 'friend', 'colleague', 'partner',
  'concern', 'goal_link', 'location', 'works_at', 'lives_in', 'connected_to',
] as const;

const SYSTEM_PROMPT = `Ты — аналитик знаний LifeOS. Из сообщения пользователя извлеки ТОЛЬКО именованные сущности и связи между ними.

Верни ТОЛЬКО валидный JSON без markdown, строго такого формата:
{
  "entities": [
    {
      "name": "каноническое имя (именительный падеж, полное имя если известно)",
      "type": "person|place|concept|goal|organization",
      "aliases": ["известный вариант: кличка, краткое/полное, латиница"],
      "attributes": { "ключ": "значение" },
      "changed": ["ключ"],
      "importance": 5
    }
  ],
  "relationships": [
    {
      "fromName": "имя сущности A",
      "toName": "имя сущности B",
      "type": "family|friend|colleague|partner|concern|goal_link|location|works_at|lives_in|connected_to",
      "label": "опциональное описание",
      "strength": 0.5
    }
  ]
}

Правила:
1. entities — только явно упомянутые. Не выдумывай. Мин. одно слово.
2. type выбери из фиксированного списка: ${ENTITY_TYPES.join('|')}.
3. attributes — только явно сказанное (день рождения, город, профессия и т.д.).
3b. changed — ТОЛЬКО если пользователь прямо говорит, что атрибут ИЗМЕНИЛСЯ («переехала в Астану», «теперь работает в Kaspi», «сменил номер», «больше не…», «раньше…, а теперь…»): перечисли ключи attributes с НОВЫМ значением. Обычное утверждение («мама живёт в Алматы») → НЕ добавляй поле. Ключи — короткие, по-русски: «город», «работа», «профессия», «телефон».
3c. Родственник БЕЗ имени: name = родство + различитель, если он сказан («Старший брат», «Младший брат», «Двоюродная сестра»), иначе просто «Брат». Разные различители — разные люди, не склеивай их в одного.
3d. Имя родственника названо («брата зовут Ерлан», «мой старший брат Ерлан»): name = имя («Ерлан»), aliases = [родство, как его называли раньше: «Старший брат»], attributes.relation = родство.
3a. aliases — ТОЛЬКО НЕ-морфологические варианты (кличка «Серёга» для «Сергей», латиница «Kaspi» для «Каспи», краткое↔полное). Склонения/падежи НЕ добавляй — система их сводит сама. Нет вариантов → не добавляй поле.
4. importance: 1-3 мелочь, 4-6 средне, 7-10 важно (семья, здоровье, цели).
5. relationships — только если из текста явно следует связь между двумя entities.
6. relationship.type из: ${RELATIONSHIP_TYPES.join('|')}.
6b. Местоимения («он», «она», «они», «кто-то») — НЕ сущности: из одной фразы не ясно, о ком речь. Абстракции и события («отказ», «страх», «встреча») — не person.
7. НЕ извлекай самого пользователя ("я", "пользователь", "user", собственное имя владельца) как entity — он known by context; ты пишешь его graph, не его самого.
8. Если entities нет — верни { "entities": [], "relationships": [] }.
9. НЕ добавляй объяснений, только JSON.`;

/**
 * Extract entities and relationships from free text via Claude.
 *
 * Best-effort: any error (network, parse, Claude 5xx) → returns empty
 * ExtractorResult and logs warn. Never throws.
 *
 * Normalizes entity names before returning (capitalizes, collapses spaces).
 */
export async function extractEntities(
  text: string,
  _userId: string,
  userName?: string,
): Promise<ExtractorResult> {
  const trimmed = text.trim();
  if (!trimmed) return { entities: [], relationships: [] };

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.warn('[entity-extractor] empty or non-text Claude response');
      return { entities: [], relationships: [] };
    }

    const parsed = parseExtractorResponse(content.text);

    // Normalize entity names.
    const normalizedEntities: ExtractedEntityInput[] = parsed.entities
      .map((e) => {
        const out: ExtractedEntityInput = { ...e, name: normalizeEntityName(e.name) };
        // changed — только строки и только ключи, реально пришедшие в attributes.
        const attrKeys = new Set(Object.keys(e.attributes ?? {}));
        const changed = Array.isArray(e.changed)
          ? e.changed.filter((k): k is string => typeof k === 'string' && attrKeys.has(k))
          : [];
        if (changed.length > 0) out.changed = changed;
        else delete out.changed;
        if (Array.isArray(e.aliases)) {
          out.aliases = e.aliases
            .map((a) => normalizeEntityName(String(a)))
            .filter((a) => a && !isSelfReference(a, userName) && !isPronounName(a));
        }
        return out;
      })
      // Drop self-references — the user is not an entity in their own graph.
      // И местоимения: «он» — не человек, о ком он — неизвестно.
      .filter((e) => e.name && !isSelfReference(e.name, userName) && !isPronounName(e.name));

    // Build a set of dropped names so we can skip relationships involving them.
    const droppedNames = new Set(
      parsed.entities
        .map((e) => normalizeEntityName(e.name))
        .filter((n) => isSelfReference(n, userName)),
    );

    // Normalize relationship fromName/toName to match normalized entity names.
    // Drop relationships that involve a dropped self-reference endpoint —
    // otherwise upstream will try to upsert "Я" as a person.
    const normalizedRelationships: ExtractedRelationshipInput[] = parsed.relationships
      .map((r) => ({
        ...r,
        fromName: normalizeEntityName(r.fromName),
        toName: normalizeEntityName(r.toName),
      }))
      .filter(
        (r) =>
          !isSelfReference(r.fromName, userName) &&
          !isSelfReference(r.toName, userName) &&
          !droppedNames.has(r.fromName) &&
          !droppedNames.has(r.toName),
      );

    return {
      entities: normalizedEntities,
      relationships: keepResolvableRelationships(normalizedEntities, normalizedRelationships),
    };
  } catch (err) {
    console.warn(
      '[entity-extractor] extractEntities failed:',
      err instanceof Error ? err.message : err,
    );
    return { entities: [], relationships: [] };
  }
}
