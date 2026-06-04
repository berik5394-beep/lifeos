export type Verdict = 'worked' | 'didnt' | 'mixed';

const DAY_MS = 86_400_000;

const VERDICT_SYNONYMS: Record<string, Verdict> = {
  worked: 'worked',
  сработало: 'worked',
  да: 'worked',
  успех: 'worked',
  окупилось: 'worked',
  didnt: 'didnt',
  "didn't": 'didnt',
  нет: 'didnt',
  провал: 'didnt',
  неудача: 'didnt',
  mixed: 'mixed',
  частично: 'mixed',
  смешанно: 'mixed',
  'так-себе': 'mixed',
};

/** Defensive: текст вердикта → канон | null. */
export function parseVerdict(raw: string): Verdict | null {
  const key = raw.trim().toLowerCase();
  return VERDICT_SYNONYMS[key] ?? null;
}

/** Win-rate по проверенным решениям. Только 'worked' = успех. */
export function computeWinRate(
  reviewed: { verdict: string | null }[],
): { reviewed: number; worked: number; rate: number | null } {
  const total = reviewed.length;
  const worked = reviewed.filter((d) => d.verdict === 'worked').length;
  return { reviewed: total, worked, rate: total === 0 ? null : worked / total };
}

/** Строка проактивного возврата к решению. */
export function describeDecisionReview(
  d: { title: string; expectedOutcome?: string | null; decidedAt: Date },
  now: Date,
): string {
  const weeks = Math.max(
    1,
    Math.floor((now.getTime() - d.decidedAt.getTime()) / (7 * DAY_MS)),
  );
  const exp = d.expectedOutcome ? `, ожидал «${d.expectedOutcome}»` : '';
  return `${weeks} нед назад ты решил «${d.title}»${exp} — как на самом деле вышло?`;
}
