import { ruDayName } from '../goal-slot.js';
import { addCivilDays } from '../../lib/tz.js';
import { STAGE_LABEL, OPEN_STAGES, type DealStage } from './stages.js';

/** Тексты робота про сделки. Чистое: только данные из БД, ничего не додумываем. */

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const s = Number.isInteger(m) ? String(m) : m.toFixed(1).replace('.', ',');
    return `${s} млн ₸`;
  }
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
}

/** Точная сумма для денежных подтверждений: «2 345 678 ₸» (без округления до млн). */
export function fmtMoneyExact(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
}

export function whenPhrase(date: string, today: string): string {
  if (date === today) return 'сегодня';
  if (date === addCivilDays(today, 1)) return 'завтра';
  const dd = `${date.slice(8, 10)}.${date.slice(5, 7)}`;
  const day = ruDayName(date);
  const prep = day === 'вторник' ? 'во' : 'в';
  return `${prep} ${day} (${dd})`;
}

/** Родительный «отметил Ахмета», «закроешь Серика»: согласная → +а. */
export function genitive(name: string): string {
  return /[бвгджзклмнпрстфхцчшщ]$/i.test(name) ? `${name}а` : name;
}

interface DealLike {
  personName: string;
  title: string;
  amount: number | null;
  stage: DealStage | string;
}

function head(d: DealLike): string {
  return `${d.personName} — ${d.title}`;
}

export function describeCreated(
  d: DealLike,
  taggedClient: boolean,
  step: { date: string; text: string } | null,
  today: string,
): string {
  const parts = [`Записал сделку: ${head(d)}${d.amount != null ? `, ${fmtMoney(d.amount)}` : ''}, стадия «${STAGE_LABEL[d.stage as DealStage] ?? d.stage}».`];
  if (taggedClient) parts.push(`${genitive(d.personName)} отметил клиентом.`);
  if (step) parts.push(`Напомню ${step.text} ${whenPhrase(step.date, today)}.`);
  return parts.join(' ');
}

export function describeUpdated(
  d: DealLike,
  r: { stageChanged: boolean; step: { date: string; text: string } | null; incomeOffer: boolean },
  today: string,
): string {
  const parts = [`Сделка ${head(d)}: ${r.stageChanged ? `стадия «${STAGE_LABEL[d.stage as DealStage] ?? d.stage}»` : 'обновил'}.`];
  if (r.step) parts.push(`Напомню ${r.step.text} ${whenPhrase(r.step.date, today)}.`);
  if (r.incomeOffer && d.amount != null) parts.push(`Записать доход ${fmtMoney(d.amount)} от ${genitive(d.personName)}?`);
  else if (d.stage === 'won' && d.amount == null) parts.push('Скажи сумму — запишу доход.');
  return parts.join(' ');
}

interface ListDeal extends DealLike {
  nextStepAt: string | null;
  nextStepText: string | null;
}

/** Русское множественное: plural(n, ['сделка', 'сделки', 'сделок']). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function dealsWord(n: number): string {
  return plural(n, ['сделка', 'сделки', 'сделок']);
}

/** «У Ахмета 2 открытые сделки: «…», «…». Про какую?» */
export function describeWhichDeal(
  name: string,
  deals: ReadonlyArray<{ title: string; amount: number | null }>,
  question = 'Про какую?',
): string {
  const list = deals.map((d) => `«${d.title}»${d.amount != null ? ` (${fmtMoney(d.amount)})` : ''}`).join(', ');
  const n = deals.length;
  return `У ${genitive(name)} ${n} ${plural(n, ['открытая сделка', 'открытые сделки', 'открытых сделок'])}: ${list}. ${question}`;
}

/** Страховка от двойного дохода: такой же уже записан. */
export function describePossibleDuplicate(amount: number, personName: string, dateCivil: string): string {
  return `Похоже, этот доход уже записан (${fmtMoneyExact(amount)} от ${genitive(personName)}, ${dateCivil.slice(8, 10)}.${dateCivil.slice(5, 7)}). Записать ещё раз?`;
}

export function describeList(deals: readonly ListDeal[], today: string): string {
  if (deals.length === 0) return 'Открытых сделок нет. Скажи «Ахмет хочет … на 2 млн» — заведу.';
  const sum = deals.reduce((s, d) => s + (d.amount ?? 0), 0);
  const lines = [`Открыто ${deals.length} ${dealsWord(deals.length)}${sum > 0 ? ` на ${fmtMoney(sum)}` : ''}.`];
  for (const st of OPEN_STAGES) {
    const inStage = deals.filter((d) => d.stage === st);
    if (!inStage.length) continue;
    lines.push(`${STAGE_LABEL[st]}: ${inStage.map((d) => `${head(d)}${d.amount != null ? ` (${fmtMoney(d.amount)})` : ''}`).join('; ')}.`);
  }
  const due = deals.filter((d) => d.nextStepAt === today);
  if (due.length) lines.push(`Сегодня: ${due.map((d) => `${d.personName} — ${d.nextStepText ?? 'шаг'}`).join('; ')}.`);
  const overdue = deals.filter((d) => d.nextStepAt != null && d.nextStepAt < today);
  if (overdue.length) lines.push(`Просрочен шаг: ${overdue.map((d) => d.personName).join(', ')}.`);
  return lines.join('\n');
}

export function describePlan(p: {
  plan: number; won: number; open: number; behind: boolean; covering: string[]; noAmount: number;
}): string {
  const parts = [`План месяца ${fmtMoney(p.plan)}: закрыто ${fmtMoney(p.won)}, в работе ещё ${fmtMoney(p.open)}.`];
  if (p.won >= p.plan) parts.push('План выполнен!');
  else if (p.covering.length) parts.push(`Успеешь, если закроешь ${p.covering.map(genitive).join(' и ')}.`);
  else parts.push('В работе не хватает на план — нужны новые сделки.');
  if (p.noAmount > 0) parts.push(`У ${p.noAmount} ${p.noAmount === 1 ? 'сделки' : 'сделок'} нет суммы.`);
  return parts.join(' ');
}

/** Блок для контекста робота (enrichment). Нечего сказать → null. */
export function formatDealsSection(s: {
  openCount: number; openSum: number; clients: string[]; dueToday: string[]; overdue: string[]; plan: string | null;
}): string | null {
  if (s.openCount === 0 && !s.plan) return null;
  const parts = [`Сделки: открыто ${s.openCount}${s.openSum > 0 ? ` на ${fmtMoney(s.openSum)}` : ''}`];
  // Ревью I5: модель должна знать, у кого открыта сделка («перезвонить Ахмету» → update_deal).
  const clients = [...new Set(s.clients)].slice(0, 8);
  if (clients.length) parts.push(`клиенты в работе: ${clients.join(', ')}`);
  if (s.dueToday.length) parts.push(`шаг сегодня: ${s.dueToday.join(', ')}`);
  if (s.overdue.length) parts.push(`просрочен шаг: ${s.overdue.join(', ')}`);
  if (s.plan) parts.push(s.plan);
  return parts.join('; ') + '.';
}

/** Строка в бриф встречи с клиентом. */
export function dealBriefLine(d: { title: string; amount: number | null; stage: string; daysInStage: number }): string {
  const amount = d.amount != null ? ` ${fmtMoney(d.amount)}` : '';
  return `Сделка «${d.title}»${amount}, ${STAGE_LABEL[d.stage as DealStage] ?? d.stage} ${d.daysInStage} дн назад.`;
}

/** Творительный «с Ахметом / с Даной / с Алей». */
export function instrumental(name: string): string {
  if (/а$/i.test(name)) return name.slice(0, -1) + 'ой';
  if (/я$/i.test(name)) return name.slice(0, -1) + 'ей';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(name)) return `${name}ом`;
  return name;
}
