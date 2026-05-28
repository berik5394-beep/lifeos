/**
 * Централизованные имена Anthropic моделей (SSOT 2026-05-28).
 *
 * Bug history (root cause Aydana «Действие НЕ выполнено»):
 *  - claude-haiku-4-20250514 — НИКОГДА не существовала в Anthropic API
 *    (Haiku 4 такой релиз не было — была сразу Haiku 4.5). Hardcoded
 *    в safety/emotional classifiers → 404 в проде → Tier-2 classifier
 *    тихо отключён → fallback на phrase-net. Это видно в Aydana
 *    скринах (бот не ловил emo subtle), И в логах:
 *      [emo] Haiku classify failed (fallback to phrase-net): 404
 *      {"error":{"type":"not_found_error",
 *       "message":"model: claude-haiku-4-20250514"}}
 *  - claude-sonnet-4-20250514 — DEPRECATED, retirement 2026-06-15.
 *    Hardcoded в 14 файлах → если ANY одна из 14 точек упадёт
 *    с 404/deprecated после retirement → cascade fail.
 *
 * Раньше: каждый файл хардкодил имя → при изменении модели нужно
 * обновлять 16 точек, легко пропустить.
 *
 * Теперь: один источник правды. Меняем здесь — все callsites автоматом.
 * Plus: structural lint test (env-key-discipline pattern) гарантирует
 * что ANY будущий hardcoded `claude-*` snapshot ВНЕ этого файла → CI
 * красный ДО прод-деплоя.
 *
 * Источник имён: https://platform.claude.com/docs/en/docs/about-claude/models/overview
 * (проверено 2026-05-28: dateless format в 4.6+ generation = pinned
 * snapshot, обновляется когда Anthropic релизит новую generation).
 */
export const MODELS = {
  /** Самая мощная (агент / комплексное reasoning). $5 / $25 MTok. */
  opus: 'claude-opus-4-7',
  /** Баланс speed/intelligence. Default для agent / chat. $3 / $15 MTok. */
  sonnet: 'claude-sonnet-4-6',
  /** Самая быстрая (classifiers / batch). $1 / $5 MTok. */
  haiku: 'claude-haiku-4-5',
} as const;
