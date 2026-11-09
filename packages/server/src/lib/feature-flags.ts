/**
 * v2.0 Feature flags — controls gradual rollout per-user.
 *
 * Used to gate per-user rollout of v2 features (single-writer memory,
 * proactivity, axes, …). Legacy captureMemory was removed in M3.
 *
 * Env value formats (same for both flags):
 *   "all"                          — enabled for everyone
 *   "" | "none" | "false" | unset  — disabled
 *   "user-{id1},user-{id2}"        — only listed userIds
 *
 * Whitespace around entries and around the whole value is ignored.
 */

function isEnabledForUser(envValue: string | undefined, userId: string): boolean {
  const flag = (envValue ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  if (flag === 'all') return true;
  return flag
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === `user-${userId}`);
}

/**
 * Разбор цели при постановке (спека 2026-11-08-goal-intake-check): после записи
 * годовой цели — деньги/темп/время/привычки + одно предложение «да». OFF → ответ
 * «Цель записана…» байт-в-байт как раньше, разбор не считается и не пишется.
 */
export function isV2GoalIntakeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_GOAL_INTAKE, userId);
}

/**
 * Задача↔цель: после создания задачи фоном (haiku) привязать её к годовой
 * цели, если она явный шаг к ней — детектор «цель стоит» видит работу по цели.
 * OFF → задачи не привязываются (как раньше), вызова ИИ нет.
 */
export function isV2TaskGoalLinkEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_TASK_GOAL_LINK, userId);
}

/**
 * Состояние всех флагов FEATURE_* одной строкой для лога при старте (чистка
 * мёртвых веток, Berik 2026-11-09): значения не секрет — «all/none/true/false»,
 * а список id показываем только числом, без самих id.
 */
export function featureFlagSnapshot(env: NodeJS.ProcessEnv = process.env): string {
  return Object.keys(env)
    .filter((k) => k.startsWith('FEATURE_'))
    .sort()
    .map((k) => {
      const v = (env[k] ?? '').trim();
      const shown = v === '' || ['all', 'none', 'true', 'false', 'on', 'off'].includes(v.toLowerCase())
        ? v || '(пусто)'
        : `список(${v.split(',').filter((x) => x.trim()).length})`;
      return `${k.replace(/^FEATURE_/, '')}=${shown}`;
    })
    .join(' ');
}
