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

export function isV2MemoryEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEMORY, userId);
}

export function isV2ProactivityEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_PROACTIVITY, userId);
}

/**
 * v2 Phase B1 — Per-user gate for USER NEST axes feature.
 *
 * Values:
 *   "all" / "true"     → enabled for everyone
 *   "" / "none" / "false" / unset → disabled for everyone
 *   "user-X,user-Y"    → enabled only for those users (comma list)
 */
export function isV2AxesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_AXES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Привычка↔цель (interconnection, аудит-фикс). Same shape as isV2AxesEnabled.
 */
export function isV2GoalHabitsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_GOAL_HABITS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Память ДР (ключевые даты, мост #2). Same shape as isV2AxesEnabled:
 * "all"/"true", "none"/"false"/unset, or comma list "user-X,user-Y".
 */
export function isV2BirthdayEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_BIRTHDAY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Напоминание «за 30 мин до задачи» (P1 HOLLOW fix). Новый push-выход в
 * scheduler → off=байт-идентично. Same shape: "all"/"true", "none"/"false"/unset, "user-X".
 */
export function isV2TaskReminderEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_TASK_REMINDER;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Конфликт задача↔календарь (кросс-домен слой B) — врезка в мозг. Same shape.
 */
export function isV2ScheduleConflictEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_SCHEDULE_CONFLICT;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Недавняя активность в мозг (v2-натив reader, шаг M3). Главный путь
 * enrichment читает свежие события Memory по createdAt → любой captureActivity
 * сразу виден. Same shape: "all"/"true", "none"/"false"/unset, "user-X".
 */
export function isV2RecentActivityEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RECENT_ACTIVITY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Obligations (память отношений+обещаний). Same shape as isV2AxesEnabled:
 * "all"/"true", "none"/"false"/unset, or comma list "user-X,user-Y".
 */
export function isV2ObligationsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_OBLIGATIONS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Goal-Impact (кросс-домен Срез 1). Same shape as isV2AxesEnabled:
 * "all"/"true", "none"/"false"/unset, or comma list "user-X,user-Y".
 */
export function isV2GoalImpactEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_GOAL_IMPACT;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Runway (кросс-домен #1). Same shape as isV2AxesEnabled:
 * "all"/"true", "none"/"false"/unset, or comma list "user-X,user-Y".
 */
export function isV2RunwayEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RUNWAY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Runway-баланс: якорь cashOnHand из CashSnapshot + инструмент set_balance.
 * Same shape as isV2AxesEnabled (env FEATURE_V2_RUNWAY_BALANCE).
 */
export function isV2RunwayBalanceEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RUNWAY_BALANCE;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Решения↔исходы: журнал решений + ретро + детектор decision_review.
 * Same shape as isV2AxesEnabled (env FEATURE_V2_DECISIONS).
 */
export function isV2DecisionsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_DECISIONS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Energy↔Result (кросс-домен #2). Same shape as isV2AxesEnabled.
 */
export function isV2EnergyEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENERGY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Relationships / CRM-link (кросс-домен #3). Same shape as isV2AxesEnabled.
 */
export function isV2RelationshipsEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_RELATIONSHIPS;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2.0 Week 6 — global cron flag.
 *
 * Crons are global jobs (one sweep affects all users), so no per-user
 * tagging. Enable on Railway with FEATURE_V2_CRON=true once the v2
 * memory dual-write has been running for at least a few days (Week 7
 * after Berik SMOKE passes).
 */
export function isV2CronEnabled(): boolean {
  const flag = (process.env.FEATURE_V2_CRON ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  return flag === 'true' || flag === 'all';
}

/**
 * v2 Phase B2 — Per-user gate for bot Identity Evolution feature.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2IdentityEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_IDENTITY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 Phase B3 — Per-user gate for the cross-session feedback loop.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2FeedbackEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_FEEDBACK;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 Phase B4 — Per-user gate for Hermes composable skills.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2HermesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_HERMES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * Reflector v2 — Per-user gate for cross-tier synthesis. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2ReflectorEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_REFLECTOR;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}

/**
 * v2 P2 — Per-user gate for engagement-aware proactivity. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2EngagementEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENGAGEMENT;
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
 * ОДНА ПАМЯТЬ M2 — Per-user gate единого писателя в recordEvent.
 * on  → writeMemory (дедуп + условный embed). FEATURE_V2_WRITE=all в проде.
 * off → plain memory.create (без дедупа/embed), байт-в-байт до-M2 fallback.
 * Env FEATURE_V2_WRITE в форме "all" / "none"/"false"/unset / "user-X,user-Y".
 */
export function isV2WriteEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_WRITE, userId);
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
