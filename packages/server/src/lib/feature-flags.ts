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
 * T2 дедуп паттернов: экстракторы находят СВОЙ паттерн по identity-ключу в
 * payload (entityId / habitId / sourceMsgId / clusterIndex / weekNumber), а не
 * первый попавшийся по kind. Без этого недельный крон плодит дубликат на
 * каждом прогоне. off=байт-идентично (findFirst остаётся прежним).
 * Same shape: "all"/"true", "none"/"false"/unset, "user-X".
 */
export function isV2PatternDedupEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_PATTERN_DEDUP;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Entity coreference resolve-then-merge (T1, память-качество №1).
 * Same shape as the other per-user flags.
 */
export function isV2EntityResolveEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENTITY_RESOLVE;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * D (spec 2026-06-01): inline-проактивность из длинного текста.
 * Off → байт-в-байт сегодняшнее поведение. Env FEATURE_V2_INLINE_NUDGE
 * в форме "all"/"true" / "none"/unset / "user-X,user-Y".
 */
export function isV2InlineNudgeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_INLINE_NUDGE, userId);
}

/**
 * Real-Time Foundation — per-user gate настоящего времени. on → tz-capture хук
 * пишет User.timezone из X-Timezone, getTimeOfDay в поясе юзера, блок «СЕЙЧАС»
 * в промпте. off → байт-идентично (хук no-op, getTimeOfDay по серверному
 * времени, без блока). Env FEATURE_V2_REALTIME: "all"/"none"/unset/"user-X,user-Y".
 */
export function isV2RealtimeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_REALTIME, userId);
}

/**
 * Коуч по накоплениям (deadline-pacing + reactive-on-expense). Через
 * isEnabledForUser: "all" → все; "none"/"false"/unset → никто;
 * "user-X,user-Y" → перечисленные. ВНИМАНИЕ: "true" НЕ включает — для
 * глобального включения ставь "all".
 * Off → рефлектор и расходный путь работают как сегодня (байт-в-байт).
 */
export function isV2SavingsCoachEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_SAVINGS_COACH, userId);
}

/**
 * Движок пересечения, срез 1 (день перегружен). Off → create_task ответ
 * байт-в-байт (нет оценки времени, нет строки нагрузки).
 */
export function isV2DayLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_DAY_LOAD, userId);
}

/**
 * Слой честности B — анти-фабрикация фактов в чате. on → (1) пункт в базовый
 * промпт «числа/даты/имена о делах юзера ТОЛЬКО из КОНТЕКСТА, не выдумывай» +
 * (2) реальный overdue-счётчик в контекст (#5, чтобы модель не сочиняла «128»).
 * off → байт-идентично (ни пункта, ни строки overdue). Env FEATURE_V2_ANTIFAB
 * ("all"/"none"/unset/"user-X"; "true" НЕ включает — ставь "all").
 */
export function isV2AntiFabEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_ANTIFAB, userId);
}

/** Движок пересечения, срез 2 (неделя перегружена). Off → байт-в-байт. */
export function isV2WeekLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_WEEK_LOAD, userId);
}

/** Движок пересечения, срез 3 (месяц). Гейтит и data-слой (оценка целей),
 *  и будущий month-load нудж. Off → байт-в-байт. */
export function isV2MonthLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MONTH_LOAD, userId);
}

/** Движок пересечения, горизонт ГОД (пейсинг измеримых целей). Off → байт-в-байт. */
export function isV2YearLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_YEAR_LOAD, userId);
}

/**
 * F2 явная коррекция: при ЯВНОЙ отмене факта инвалидируем старую противоречащую
 * память (обратимо). OFF → детект выключен + шаг инвалидации выключен → identical.
 */
export function isV2SupersedeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_SUPERSEDE, userId);
}

/**
 * F2-связи: явный ретайр отношения (end_relationship). OFF → handler {error},
 * связь не трогается (DB identical). Тул в capabilityText всегда (как cancel_obligation).
 */
export function isV2UnlinkEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_UNLINK, userId);
}

/**
 * Перегруз дня → робот предлагает сдвинуть график одним касанием + предупреждение
 * о целях недели/месяца/года (спека 2026-11-05-day-overload-reschedule). Off →
 * create_task / POST /tasks / PUT /tasks байт-идентичны прежним.
 */
export function isV2RescheduleEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_RESCHEDULE, userId);
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
