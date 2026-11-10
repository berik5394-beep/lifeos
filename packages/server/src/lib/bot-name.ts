/**
 * Имя робота — одно везде (2026-11-10, тест «характер не поплыл» нашёл: один и
 * тот же робот представлялся то «Jarvis» (промпт), то «Эля» (умолчание профиля),
 * а приложение и «Привет, ЛайфОС» зовут его ЛайфОС).
 * Своё имя, которое дал человек, — уважаем; старые умолчания → ЛайфОС.
 */
export const DEFAULT_BOT_NAME = 'ЛайфОС';
const LEGACY_DEFAULTS = new Set(['эля', 'jarvis', 'джарвис', 'lifeos', 'лайфос']);

export function botDisplayName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n && !LEGACY_DEFAULTS.has(n.toLowerCase()) ? n : DEFAULT_BOT_NAME;
}
