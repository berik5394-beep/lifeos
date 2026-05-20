import type { InsightCandidate } from './insight-core.js';

/**
 * Phase 6 C4.1 — ДЕТЕРМИНИСТСКИЕ детекторы терапевтических
 * триггеров (чистые функции, без БД/AI). Все эмитят InsightCandidate
 * с source='reflector' и kind:'therapeutic_*'; персистятся через
 * insight-store.persistCandidates (R9/R10/dedup); пушатся через
 * R6/R11. ≤1 therapeutic/день/юзер — на уровне service (берёт
 * top-severity из всех сработавших, см. therapeutic-detector-service).
 *
 * Тон сообщений (VISION): «я заметил X» — наблюдение, НЕ диагноз.
 */

const BURNOUT_MEETING_THRESHOLD = 5; // 5+ встреч/день
const BURNOUT_STREAK_DAYS = 3;
const SLEEP_DROP_RATIO = 0.7; // <70% от базовой нормы
const SLEEP_MIN_SAMPLES = 7;
const CONFLICT_FOLLOWUP_MIN_HOURS = 24;
const CONFLICT_FOLLOWUP_MAX_HOURS = 48;
const CONFLICT_FOLLOWUP_QUIET_DAYS = 7; // не возвращаемся раньше 7 дней
const INTENTION_DEVIATION_PCT = 0.3; // 30%

// ============================ 1. BURNOUT ============================

export interface BurnoutInput {
  /** События/встречи за каждый из последних N дней (новые в конце). */
  meetingsPerDay: number[];
}

export function burnoutDetector(i: BurnoutInput): InsightCandidate | null {
  const tail = i.meetingsPerDay.slice(-BURNOUT_STREAK_DAYS);
  if (tail.length < BURNOUT_STREAK_DAYS) return null;
  if (!tail.every((n) => n >= BURNOUT_MEETING_THRESHOLD)) return null;
  return {
    kind: 'therapeutic_burnout',
    scope: 'therapeutic:burnout',
    severity: 7,
    message:
      `Я заметил: последние ${BURNOUT_STREAK_DAYS} дня по ` +
      `${BURNOUT_MEETING_THRESHOLD}+ встреч. Хочешь — спланируем тебе ` +
      `выходной или хотя бы тихий вечер?`,
    rationale: `meetings tail=${tail.join(',')}`,
    source: 'reflector',
    dismissKey: 'therapeutic_burnout',
  };
}

// ====================== 2. SLEEP DISRUPTION =========================

export interface SleepInput {
  /** Часы сна по дням (журнал; null = нет записи). */
  hoursLast14d: Array<number | null>;
}

export function sleepDisruptionDetector(i: SleepInput): InsightCandidate | null {
  const recent = i.hoursLast14d.slice(-3).filter((x): x is number => x != null);
  const baseline = i.hoursLast14d.slice(0, -3).filter((x): x is number => x != null);
  if (recent.length < 2 || baseline.length < SLEEP_MIN_SAMPLES) return null;
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const r = avg(recent);
  const b = avg(baseline);
  if (b <= 0 || r / b >= SLEEP_DROP_RATIO) return null;
  return {
    kind: 'therapeutic_sleep_drop',
    scope: 'therapeutic:sleep',
    severity: 7,
    message:
      `Заметил, сон последние дни упал — в среднем ${r.toFixed(1)}ч ` +
      `против обычных ${b.toFixed(1)}ч. Как ты?`,
    rationale: `recent=${r.toFixed(2)} baseline=${b.toFixed(2)}`,
    source: 'reflector',
    dismissKey: 'therapeutic_sleep_drop',
  };
}

// ===================== 3. CONFLICT FOLLOWUP =========================

export interface ConflictInput {
  /** Упоминания конфликта в чате (snippet + время). */
  mentions: Array<{ snippet: string; at: Date }>;
  /** Когда в последний раз делали follow-up по этой теме. */
  lastFollowupAt: Date | null;
  now: Date;
}

export function conflictFollowupDetector(
  i: ConflictInput,
): InsightCandidate | null {
  // Тишина 7 дней после прошлого follow-up (уважение к «не хочу»).
  if (i.lastFollowupAt) {
    const days = (i.now.getTime() - i.lastFollowupAt.getTime()) / 86_400_000;
    if (days < CONFLICT_FOLLOWUP_QUIET_DAYS) return null;
  }
  // Самое свежее упоминание в окне 24–48ч назад.
  for (let k = i.mentions.length - 1; k >= 0; k--) {
    const m = i.mentions[k];
    const hours = (i.now.getTime() - m.at.getTime()) / 3_600_000;
    if (hours >= CONFLICT_FOLLOWUP_MIN_HOURS && hours <= CONFLICT_FOLLOWUP_MAX_HOURS) {
      const ref = m.snippet.slice(0, 60);
      return {
        kind: 'therapeutic_conflict_followup',
        scope: 'therapeutic:conflict',
        severity: 6,
        message:
          `Я заметил, ${Math.round(hours)}ч назад ты упоминал: «${ref}». ` +
          `Как ты сейчас?`,
        rationale: `mention=${m.at.toISOString()}`,
        source: 'reflector',
        dismissKey: 'therapeutic_conflict_followup',
      };
    }
  }
  return null;
}

// ==================== 4. MISSED IMPORTANT DATE ======================

export interface ImportantDateInput {
  /** Memory.type='important_date' для юзера. */
  dates: Array<{ what: string; date: Date }>;
  /** Локальная дата сегодня в формате YYYY-MM-DD (передаётся glue). */
  todayLocal: string;
}

export function missedImportantDateDetector(
  i: ImportantDateInput,
): InsightCandidate | null {
  const match = i.dates.find((d) => {
    const md = d.date.toISOString().slice(5, 10); // MM-DD
    const today = i.todayLocal.slice(5, 10);
    return md === today;
  });
  if (!match) return null;
  return {
    kind: 'therapeutic_important_date',
    scope: `therapeutic:date:${match.what}`,
    severity: 6,
    message: `Сегодня ${match.what}. Поздравил уже? Если хочешь — помогу с тёплым сообщением.`,
    rationale: `date=${match.date.toISOString().slice(0, 10)}`,
    source: 'reflector',
    dismissKey: `therapeutic_important_date_${match.what}`,
  };
}

// ==================== 5. INTENTION DEVIATION ========================

export interface IntentionInput {
  /** Что юзер сам говорил (напр. «меньше тратить на еду»). */
  stated: string;
  /** Метрика прошлой недели и этой (то же измерение). */
  lastWeekValue: number;
  thisWeekValue: number;
  /** «Хорошо» = меньше или больше? eat→меньше; шаги→больше. */
  direction: 'less' | 'more';
}

export function intentionDeviationDetector(
  i: IntentionInput,
): InsightCandidate | null {
  if (i.lastWeekValue <= 0) return null;
  const delta = (i.thisWeekValue - i.lastWeekValue) / i.lastWeekValue;
  const worse =
    i.direction === 'less'
      ? delta >= INTENTION_DEVIATION_PCT
      : delta <= -INTENTION_DEVIATION_PCT;
  if (!worse) return null;
  const pct = Math.round(Math.abs(delta) * 100);
  return {
    kind: 'therapeutic_intention_deviation',
    scope: `therapeutic:intention:${i.stated.slice(0, 40)}`,
    severity: 6,
    message:
      `Ты говорил: «${i.stated}». Эта неделя — на ${pct}% ` +
      `${i.direction === 'less' ? 'больше' : 'меньше'} прошлой. Хочешь обсудить?`,
    rationale: `delta=${(delta * 100).toFixed(1)}%`,
    source: 'reflector',
    dismissKey: `therapeutic_intention_deviation_${i.stated.slice(0, 40)}`,
  };
}
