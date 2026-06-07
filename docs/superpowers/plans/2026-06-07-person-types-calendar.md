# Person-Types (CRM мост #2) — План B (календарь-бриф + усиления)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Goal:** Бриф перед встречей на НАШЕМ внутреннем календаре + нашем tz-времени («📅 через ~50 мин — встреча с [клиент] Ахмет. Последний контакт 12 дн. Открыто: «договор». Должен тебе 200000₸.») + усилить shipped relationship/birthday-нуджи приоритетом по типу (буст, не суппресс).

**Architecture:** READ-ONLY. `buildPersonMeetingBriefs` джойнит сегодняшние внутренние `CalendarEvent` × person-сущности (консервативный матч имени) × тип/каденс/обязательство/деньги. Два слоя: enrichment-врезка (надёжно) + проактивный `detectPersonMeeting` (significance ≥0.8 → severity ≥8 critical → обходит receptive-hour defer; entityId=человек → per-meeting cooldown). Усиления = аддитивный буст значимости (off-safe через `?? threshold`). Флаг `isV2PersonTypesEnabled` (из Plan A) уже all. БЕЗ миграции.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict (no any), vitest (zero vi.mock). Baseline unit ~2644 + integration ~133 зелёные. Commit-per-step + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. .env=ПРОД, миграции НЕТ. Push/deploy — по слову Berik.

**Несущие факты (валидированы чтением):** cooldown scope `${source}:${entityId??'global'}`; `severity = round(significance*10)`, defer обходит `severity≥8`; движок шлёт top-1/тик (пуш best-effort, врезка надёжна). `localDateOnlyUTC(tz)` = @db.Date сегодня; `localTimeStr(tz)` = «HH:MM» h23; `normalizeHabit` = lowercase+пунктуация+схлоп (без стемминга). `no-write-guard.test.ts` сканит ВСЕ .ts в person-types через readdirSync → новые файлы авто-под-гардом.

---

## File Structure
| Файл | Действие | Ответственность |
|---|---|---|
| `src/services/person-types/meeting.ts` | Create | Чистые: `matchPersonInText`, `minutesUntil`, `describeMeetingBrief` + тип `PersonMeetingBrief`. |
| `src/services/person-types/meeting.test.ts` | Create | Pure-юниты. |
| `src/services/person-types/meeting-impl.ts` | Create | `buildPersonMeetingBriefs` (READ-ONLY джойн). |
| `src/services/person-types/index.ts` | Modify | re-export meeting. |
| `src/services/person-types/person-meeting.it.test.ts` | Create | real prisma. |
| `src/services/v2-proactivity-engine.ts` | Modify | source `person_meeting` + детектор. |
| `src/services/v2-proactivity-engine.test.ts` | Modify | exhaustiveness + off-safe буст. |
| `src/services/v2-enrichment.ts` | Modify | врезка `personMeetings`. |
| `src/services/birthday/types.ts` | Modify | `personType?` в Row/Upcoming. |
| `src/services/birthday/birthday.ts` | Modify | `listPersonBirthdays` кладёт personType. |
| `src/services/relationship-link/types.ts` + `relationship-link.ts` | Modify | `typeWeight` в RelationshipNudge. |
| `src/services/person-meeting-wiring.test.ts` | Create | структурный гард. |

**Скоуп:** T1-T5 = календарь-бриф; T6-T7 = усиления; T8 = verify+ревью. Если на старте покажется крупно — расщепить на 2 деплоя (бриф / усиления); код независим.

---

## Task 1: Чистое ядро `meeting.ts`

**Files:** Create `src/services/person-types/meeting.ts`, `meeting.test.ts`

- [ ] **Step 1: Failing test** — `meeting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { matchPersonInText, minutesUntil, describeMeetingBrief, type PersonMeetingBrief } from './meeting.js';

describe('matchPersonInText', () => {
  it('точный токен', () => { expect(matchPersonInText('Ахмет', [], 'встреча Ахмет договор')).toBe(true); });
  it('префикс (склонение): Серик → «сериком»', () => { expect(matchPersonInText('Серик', [], 'обсудить с Сериком')).toBe(true); });
  it('alias матчит', () => { expect(matchPersonInText('Сергей', ['Серёга'], 'звонок Серёге')).toBe(false); /* Серёге не префикс Серёга */ });
  it('alias точный', () => { expect(matchPersonInText('Сергей', ['Серёга'], 'привет Серёга')).toBe(true); });
  it('короткое имя <3 норм-символов → не матчим (шум)', () => { expect(matchPersonInText('Ян', [], 'январь план')).toBe(false); });
  it('случайное слово не ложноматчит: «командой» ≠ «Команда»', () => { expect(matchPersonInText('Команда', [], 'встреча с командой')).toBe(false); });
  it('нет имени в тексте → false', () => { expect(matchPersonInText('Ахмет', [], 'обычная встреча')).toBe(false); });
});

describe('minutesUntil', () => {
  it('будущее', () => { expect(minutesUntil('13:00', '14:30')).toBe(90); });
  it('прошло → отрицательное', () => { expect(minutesUntil('15:00', '14:00')).toBe(-60); });
});

describe('describeMeetingBrief', () => {
  const base: PersonMeetingBrief = { entityId: 'e', name: 'Ахмет', type: 'client', startTime: '14:00', minutesUntil: 50, daysSince: 12 };
  it('богатый кросс-домен: тип + контакт + дело + деньги', () => {
    const s = describeMeetingBrief({ ...base, obligation: 'договор', owed: 200000 });
    expect(s).toContain('Ахмет'); expect(s).toContain('клиент'); expect(s).toContain('12 дн');
    expect(s).toContain('договор'); expect(s).toContain('200000');
  });
  it('далёкая встреча → «сегодня в HH:MM»', () => {
    expect(describeMeetingBrief({ ...base, minutesUntil: 200 })).toContain('сегодня в 14:00');
  });
});
```

- [ ] **Step 2: Run → fail.** `cd packages/server && npx vitest run src/services/person-types/meeting.test.ts`.

- [ ] **Step 3: Implement** — `meeting.ts`:

```typescript
import { normalizeHabit } from '../../tools/_habit-match.js';
import type { PersonType } from './types.js';

export interface PersonMeetingBrief {
  entityId: string;
  name: string;
  type?: PersonType;
  startTime: string; // 'HH:MM' локальное
  minutesUntil: number;
  daysSince: number;
  obligation?: string;
  owed?: number;
  insightText?: string;
}

const TYPE_LABEL: Record<PersonType, string> = {
  client: 'клиент', investor: 'инвестор', partner: 'партнёр', family: 'семья', friend: 'друг',
};

/**
 * Консервативный матч человека в тексте события (D2): нормализованный токен
 * события === токену имени/алиаса ИЛИ начинается с него (склонение Серик→
 * «сериком»). Мин. длина норм-токена 3 (шум коротких имён). БЕЗ Левенштейна
 * (ложный бриф про не того хуже пропуска).
 */
export function matchPersonInText(name: string, aliases: string[], text: string): boolean {
  const eventTokens = normalizeHabit(text).split(' ').filter((t) => t.length >= 3);
  if (eventTokens.length === 0) return false;
  const nameTokens = [name, ...aliases]
    .flatMap((c) => normalizeHabit(c).split(' '))
    .filter((t) => t.length >= 3);
  for (const nt of nameTokens) {
    for (const et of eventTokens) {
      if (et === nt || et.startsWith(nt)) return true;
    }
  }
  return false;
}

/** Минут до начала события сегодня (отрицательное = уже прошло). 'HH:MM' локальные. */
export function minutesUntil(nowHHMM: string, startHHMM: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return toMin(startHHMM) - toMin(nowHHMM);
}

/** Богатый бриф: тип + каденс + открытое дело + долг тебе. Чистый. */
export function describeMeetingBrief(b: PersonMeetingBrief): string {
  const label = b.type ? `[${TYPE_LABEL[b.type]}] ` : '';
  const when = b.minutesUntil <= 75 ? `через ~${b.minutesUntil} мин` : `сегодня в ${b.startTime}`;
  let s = `📅 ${when} — встреча с ${label}${b.name}. Последний контакт ${b.daysSince} дн.`;
  if (b.obligation) s += ` Открыто: «${b.obligation}».`;
  if (b.owed && b.owed > 0) s += ` Должен тебе ${b.owed}₸.`;
  return s;
}
```

- [ ] **Step 4: Run → pass.** Note: alias-тест #3 проверяет, что «Серёге» НЕ префикс «серёга» (склонение меняет основу) → false (precision). #4 «Серёга»===«серёга» → true.

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/person-types/meeting.ts packages/server/src/services/person-types/meeting.test.ts
git commit -F - <<'EOF'
feat(person-types): meeting.ts — консервативный матч имя↔событие + minutesUntil (B-T1)

matchPersonInText (токен===/префикс, len≥3, имя+aliases, БЕЗ Левенштейна — precision).
minutesUntil. describeMeetingBrief (богатый кросс-домен: тип+каденс+дело+деньги).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Gather `meeting-impl.ts` (READ-ONLY джойн)

**Files:** Create `src/services/person-types/meeting-impl.ts`, `person-meeting.it.test.ts`; Modify `src/services/person-types/index.ts`

- [ ] **Step 1: Failing it-test** — `person-meeting.it.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildPersonMeetingBriefs } from './meeting-impl.js';
import { localDateOnlyUTC, localTimeStr } from '../../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}
// событие сегодня, через 1 час от локального «сейчас»
function futureHHMM(): string {
  const [h, m] = localTimeStr('Asia/Almaty').split(':').map(Number);
  const t = (h * 60 + m + 60) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

describe('buildPersonMeetingBriefs — real prisma', () => {
  it('сегодня событие с именем клиента + дело → бриф с типом+делом', async () => {
    const u = await mkUser('pm-a@a.test');
    const e = await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Ахмет', attributes: { personType: 'client' }, lastSeenAt: new Date(Date.now() - 12 * 86400000) } });
    await prisma.obligation.create({ data: { userId: u, personEntityId: e.id, personName: 'Ахмет', direction: 'i_owe', kind: 'action', description: 'договор', status: 'open', source: 'manual' } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с Ахметом', date: localDateOnlyUTC('Asia/Almaty'), startTime: futureHHMM(), source: 'manual' } });
    const briefs = await buildPersonMeetingBriefs(u);
    expect(briefs.length).toBe(1);
    expect(briefs[0].name).toBe('Ахмет');
    expect(briefs[0].type).toBe('client');
    expect(briefs[0].obligation).toBe('договор');
  });
  it('событие без матча человека → пусто', async () => {
    const u = await mkUser('pm-b@a.test');
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Ахмет', attributes: { personType: 'client' } } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Обычная встреча', date: localDateOnlyUTC('Asia/Almaty'), startTime: futureHHMM(), source: 'manual' } });
    expect(await buildPersonMeetingBriefs(u)).toEqual([]);
  });
  it('матч есть, но НЕТ CRM-контекста (без типа/дела/денег) → пусто (D1-гейт)', async () => {
    const u = await mkUser('pm-c@a.test');
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Данияр', attributes: {} } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Кофе с Данияром', date: localDateOnlyUTC('Asia/Almaty'), startTime: futureHHMM(), source: 'manual' } });
    expect(await buildPersonMeetingBriefs(u)).toEqual([]);
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('pm-iso-a@a.test');
    const b = await mkUser('pm-iso-b@a.test');
    const e = await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Бекзат', attributes: { personType: 'investor' } } });
    await prisma.calendarEvent.create({ data: { userId: a, title: 'Звонок Бекзату', date: localDateOnlyUTC('Asia/Almaty'), startTime: futureHHMM(), source: 'manual' } });
    expect(await buildPersonMeetingBriefs(b)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — `meeting-impl.ts`:

```typescript
import { prisma } from '../../lib/prisma.js';
import { getUserTimezone } from '../../lib/user-context.js';
import { localDateOnlyUTC, localTimeStr } from '../../lib/tz.js';
import { matchPersonInText, minutesUntil, describeMeetingBrief, type PersonMeetingBrief } from './meeting.js';
import type { PersonType } from './types.js';

const DAY_MS = 86_400_000;

/**
 * Бриф перед встречей: сегодняшние ВНУТРЕННИЕ CalendarEvent × person-сущности
 * (консервативный матч имени) × тип/каденс/обязательство/owed-деньги. READ-ONLY.
 * D1-гейт: бриф только если есть CRM-контекст (тип ИЛИ дело ИЛИ долг тебе).
 * Время — наша lib/tz (НЕ Google, НЕ серверный UTC). Сорт по близости.
 */
export async function buildPersonMeetingBriefs(
  userId: string,
  now: Date = new Date(),
): Promise<PersonMeetingBrief[]> {
  try {
    const tz = await getUserTimezone(userId);
    const today = localDateOnlyUTC(tz, now);
    const nowHHMM = localTimeStr(tz, now);
    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: today, startTime: { not: null } },
      select: { title: true, description: true, startTime: true },
    });
    if (events.length === 0) return [];
    const people = await prisma.entity.findMany({
      where: { userId, type: 'person' },
      select: { id: true, name: true, aliases: true, attributes: true, lastSeenAt: true },
    });
    if (people.length === 0) return [];

    const obls = await prisma.obligation.findMany({
      where: { userId, status: 'open', personEntityId: { in: people.map((p) => p.id) } },
      select: { personEntityId: true, kind: true, direction: true, amount: true, description: true },
    });
    const oblByEntity = new Map<string, { desc?: string; owed?: number }>();
    for (const o of obls) {
      if (!o.personEntityId) continue;
      const cur = oblByEntity.get(o.personEntityId) ?? {};
      if (!cur.desc) cur.desc = o.description;
      if (o.kind === 'money' && o.direction === 'owed_to_me' && o.amount) cur.owed = (cur.owed ?? 0) + o.amount;
      oblByEntity.set(o.personEntityId, cur);
    }

    const briefs: PersonMeetingBrief[] = [];
    for (const e of events) {
      const mins = minutesUntil(nowHHMM, e.startTime as string);
      if (mins <= 0) continue; // уже прошло
      const text = `${e.title} ${e.description ?? ''}`;
      const person = people.find((p) => matchPersonInText(p.name, p.aliases, text));
      if (!person) continue;
      const attrs = (person.attributes ?? {}) as Record<string, unknown>;
      const type = typeof attrs.personType === 'string' ? (attrs.personType as PersonType) : undefined;
      const ob = oblByEntity.get(person.id);
      if (!type && !ob?.desc && !ob?.owed) continue; // D1-гейт: только с CRM-контекстом
      const daysSince = Math.max(0, Math.floor((now.getTime() - person.lastSeenAt.getTime()) / DAY_MS));
      const brief: PersonMeetingBrief = {
        entityId: person.id,
        name: person.name,
        type,
        startTime: e.startTime as string,
        minutesUntil: mins,
        daysSince,
        obligation: ob?.desc,
        owed: ob?.owed,
      };
      brief.insightText = describeMeetingBrief(brief);
      briefs.push(brief);
    }
    briefs.sort((a, b) => a.minutesUntil - b.minutesUntil);
    return briefs;
  } catch (err) {
    console.warn('[person-types] buildPersonMeetingBriefs failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
```

- [ ] **Step 4: index.ts re-export** — добавь в `src/services/person-types/index.ts`:

```typescript
export { buildPersonMeetingBriefs } from './meeting-impl.js';
export { matchPersonInText, minutesUntil, describeMeetingBrief, type PersonMeetingBrief } from './meeting.js';
```

- [ ] **Step 5: Run → pass** (it + no-write-guard авто-покрывает meeting*.ts). `npx vitest run --project integration src/services/person-types/person-meeting.it.test.ts` + `npx vitest run src/services/person-types/no-write-guard.test.ts`.

- [ ] **Step 6: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/person-types/meeting-impl.ts packages/server/src/services/person-types/index.ts packages/server/src/services/person-types/person-meeting.it.test.ts
git commit -F - <<'EOF'
feat(person-types): buildPersonMeetingBriefs — внутр.календарь↔человек↔дело↔деньги (B-T2)

READ-ONLY джойн сегодняшних CalendarEvent × person × obligation/owed, наш tz.
D1-гейт CRM-контекста. it (real prisma): бриф/без-матча/без-контекста/cross-user.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Детектор `detectPersonMeeting` (critical → обходит defer)

**Files:** Modify `src/services/v2-proactivity-engine.ts`, `v2-proactivity-engine.test.ts`

- [ ] **Step 1: Failing unit** — в `v2-proactivity-engine.test.ts` добавь `'person_meeting',` в exhaustiveness-массив (рядом с `'neglected_key_person'`).

- [ ] **Step 2: Run → fail** (TEMPLATES не покрывает).

- [ ] **Step 3a: union** — после `| 'neglected_key_person'`:

```typescript
  | 'neglected_key_person'
  | 'person_meeting';
```

- [ ] **Step 3b: scoreSignificance** — после case `'neglected_key_person'`:

```typescript
    case 'person_meeting': {
      // Время-критично: ≥0.8 → severity≥8 → critical → обходит receptive-hour defer.
      const mins = Number(c.payload.minutesUntil ?? 120);
      return Math.min(0.95, 0.8 + (mins <= 60 ? 0.1 : 0));
    }
```

- [ ] **Step 3c: TEMPLATES** — после `neglected_key_person` блока:

```typescript
  person_meeting: {
    curious: '{{insightText}}',
    gentle: '{{insightText}}',
  },
```

- [ ] **Step 3d: детектор + register** — после `detectNeglectedKeyPerson`:

```typescript
// Person-meeting: бриф перед встречей на ВНУТРЕННЕМ календаре (тип↔дело↔деньги).
async function detectPersonMeeting(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2PersonTypesEnabled } = await import('../lib/feature-flags.js');
    if (!isV2PersonTypesEnabled(userId)) return [];
    const { buildPersonMeetingBriefs } = await import('./person-types/index.js');
    const briefs = await buildPersonMeetingBriefs(userId);
    const soon = briefs.find((b) => b.minutesUntil <= 120); // ближайшая в окне (briefs сорт по времени)
    if (!soon) return [];
    const cand: NudgeCandidate = {
      source: 'person_meeting',
      significance: 0,
      entityId: soon.entityId, // per-meeting cooldown scope
      payload: { insightText: soon.insightText, minutesUntil: soon.minutesUntil, name: soon.name },
      toneHint: 'curious',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectPersonMeeting failed:', err);
    return [];
  }
}
```
И в `detectCandidates` Promise.allSettled — `detectPersonMeeting(userId),` после `detectNeglectedKeyPerson(userId),`.

- [ ] **Step 4: Run → pass.** `npx vitest run src/services/v2-proactivity-engine.test.ts`.

- [ ] **Step 5: tsc + commit.**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -F - <<'EOF'
feat(person-types): detectPersonMeeting — проактив-бриф «через час встреча» (B-T3)

source person_meeting; significance≥0.8 → severity≥8 critical → обходит receptive-hour
defer (доезжает вовремя); entityId=человек → per-meeting cooldown; окно ≤120 мин.
Ранний флаг-return. exhaustiveness.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Enrichment-врезка `personMeetings` (надёжный слой)

**Files:** Modify `src/services/v2-enrichment.ts`

- [ ] **Step 1: формат-функция** — рядом с `formatPersonTypesSection`:

```typescript
/** Person-meetings (CRM мост #2, План B) — pure render. Empty → ''. */
export function formatPersonMeetingsSection(insightText: string | null): string {
  if (!insightText) return '';
  return `Встречи сегодня (CRM): ${insightText}`;
}
```

- [ ] **Step 2: импорт** — в шапке добавь к существующему импорту person-types: `import { buildNeglectedKeyPerson } from './person-types/index.js';` уже есть → добавь `buildPersonMeetingBriefs`:

```typescript
import { buildNeglectedKeyPerson, buildPersonMeetingBriefs } from './person-types/index.js';
```

- [ ] **Step 3: тип поля** — рядом с `personTypes: string | null;`:

```typescript
  personMeetings: string | null;
```

- [ ] **Step 4: fetch** — в `Promise.all([...])` сразу ПОСЛЕ person-types fetch (последним), новый элемент:

```typescript
      isV2PersonTypesEnabled(userId)
        ? withTimeout(buildPersonMeetingBriefs(userId), CROSS_DOMAIN_BUDGET_MS, [])
            .then((bs) => (bs.length ? bs.slice(0, 2).map((b) => b.insightText).join(' · ') : null))
            .catch(() => null)
        : Promise.resolve(null),
```

- [ ] **Step 5: destructure + return** — добавь `personMeetings` ПОСЛЕ `personTypes` в деструктуризации `const [...] = await Promise.all(...)` И в возвращаемом объекте (`personMeetings,` после `personTypes,`).

- [ ] **Step 6: рендер** — рядом с `const pt = formatPersonTypesSection(...)`:

```typescript
  const pm = formatPersonMeetingsSection(data.personMeetings ?? null);
  if (pm) lines.push(pm);
```

- [ ] **Step 7: tsc (ловит рассинхрон destructure↔Promise.all)** → чисто.

- [ ] **Step 8: commit.**

```bash
git add packages/server/src/services/v2-enrichment.ts
git commit -F - <<'EOF'
feat(person-types): enrichment-врезка «встречи сегодня (CRM)» (B-T4)

Флаг-гейтнутый fetch buildPersonMeetingBriefs (топ-2) → personMeetings в промпт.
Надёжный слой: мозг всегда знает про встречи + контекст. off → null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Структурный гард (календарь-бриф) + verify

**Files:** Create `src/services/person-meeting-wiring.test.ts`

- [ ] **Step 1: Structural test:**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');

describe('person-meeting wiring (гард)', () => {
  it('person_meeting в union/score/TEMPLATES/detectCandidates', () => {
    expect(ENGINE).toContain("| 'person_meeting'");
    expect(ENGINE).toContain("case 'person_meeting':");
    expect(ENGINE).toContain('person_meeting: {');
    expect(ENGINE).toContain('detectPersonMeeting(userId),');
  });
  it('детектор ставит entityId (per-meeting cooldown) + флаг-гейт', () => {
    expect(ENGINE).toContain('entityId: soon.entityId');
    expect(ENGINE).toContain('if (!isV2PersonTypesEnabled(userId)) return [];');
  });
  it('врезка personMeetings за флагом', () => {
    expect(ENRICH).toContain('buildPersonMeetingBriefs');
    expect(ENRICH).toContain('formatPersonMeetingsSection');
  });
});
```

- [ ] **Step 2-3: Run → pass; полный verify** `npx tsc --noEmit && npx vitest run` + `npx vitest run --project integration`.

- [ ] **Step 4: commit** (`test(person-types): структурный гард календарь-бриф (B-T5)`).

---

## Task 6: Усиление `birthday_upcoming` × тип (аддитивный буст, off-safe)

**Files:** Modify `src/services/birthday/types.ts`, `src/services/birthday/birthday.ts`, `src/services/v2-proactivity-engine.ts`

- [ ] **Step 1: off-safe unit** — в `v2-proactivity-engine.test.ts` добавь:

```typescript
describe('birthday/relationship typeWeight буст off-safe', () => {
  it('birthday БЕЗ payload.typeWeight → значимость как до фичи (байт-идентично)', () => {
    const c = { source: 'birthday_upcoming', significance: 0, payload: { daysUntil: 1, importance: 5 }, toneHint: 'gentle' } as never;
    // base(daysUntil<=0?0.8:0.65=0.65) + (5-5)*0.03 + boost(typeWeight ?? 0.7 → 0)=0.65
    expect(scoreSignificance(c)).toBeCloseTo(0.65, 5);
  });
  it('birthday client (typeWeight 1.0) → буст', () => {
    const c = { source: 'birthday_upcoming', significance: 0, payload: { daysUntil: 1, importance: 5, typeWeight: 1.0 }, toneHint: 'gentle' } as never;
    expect(scoreSignificance(c)).toBeGreaterThan(0.65);
  });
});
```

- [ ] **Step 2: Run → fail** (client-кейс ещё не бустит).

- [ ] **Step 3a: типы** — `birthday/types.ts`: добавь `personType?: string;` в `PersonBirthdayRow` И `UpcomingBirthday`. В `upcomingBirthdays` (маппинг Row→Upcoming) пробрось `personType: p.personType` в каждый возвращаемый объект.

- [ ] **Step 3b: gather** — `birthday/birthday.ts` `listPersonBirthdays`: в push строки добавь personType:

```typescript
    const pt = attrs.personType;
    out.push({ entityId: r.id, name: r.name, importance: r.importance, birthday: bday, personType: typeof pt === 'string' ? pt : undefined });
```

- [ ] **Step 3c: detector** — `detectBirthday` (engine): добавь typeWeight в payload ТОЛЬКО при флаге. После построения rows, внутри цикла, перед `cand.significance = scoreSignificance(cand)`:

```typescript
      if (isV2PersonTypesEnabled(userId)) {
        const { personTypeWeight } = await import('./person-types/index.js');
        (cand.payload as Record<string, unknown>).typeWeight = personTypeWeight(r.personType);
      }
```
(добавь `import { isV2PersonTypesEnabled }` если нет; в detectBirthday уже есть динамический import isV2BirthdayEnabled — добавь рядом.)

- [ ] **Step 3d: scoreSignificance** — `birthday_upcoming` case: добавь буст с порогом-дефолтом 0.7 (off→0):

```typescript
    case 'birthday_upcoming': {
      const daysUntil = Number(c.payload.daysUntil ?? 1);
      const importance = Number(c.payload.importance ?? 5);
      const base = daysUntil <= 0 ? 0.8 : 0.65;
      const typeBoost = Math.max(0, (Number(c.payload.typeWeight ?? 0.7)) - 0.7) * 0.2;
      return Math.min(1, base + (importance - 5) * 0.03 + typeBoost);
    }
```

- [ ] **Step 4: Run → pass.** off-кейс: typeWeight отсутствует → `?? 0.7` → boost 0 → 0.65 (как было). client → +буст.

- [ ] **Step 5: tsc + commit** (`feat(person-types): усиление birthday ×тип — аддитивный буст off-safe (B-T6)`).

---

## Task 7: Усиление `relationship_link` × тип (аддитивный буст, off-safe)

**Files:** Modify `src/services/relationship-link/types.ts`, `relationship-link.ts`, `src/services/v2-proactivity-engine.ts`

- [ ] **Step 1: off-safe unit** — добавь в тот же describe:

```typescript
  it('relationship БЕЗ payload.typeWeight → как до фичи (days30,imp10 → 0.85)', () => {
    const c = { source: 'relationship_link', significance: 0, payload: { daysSince: 30, importance: 10 }, toneHint: 'gentle' } as never;
    expect(scoreSignificance(c)).toBeCloseTo(0.85, 5); // min(0.95, min(0.85,1.0) + boost(0.6→0)) = 0.85
  });
  it('relationship client (typeWeight 1.0) → буст выше 0.85', () => {
    const c = { source: 'relationship_link', significance: 0, payload: { daysSince: 30, importance: 10, typeWeight: 1.0 }, toneHint: 'gentle' } as never;
    expect(scoreSignificance(c)).toBeGreaterThan(0.85);
  });
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3a: типы** — `relationship-link/types.ts`: добавь `typeWeight?: number;` в `RelationshipLink` interface.

- [ ] **Step 3b: gather** — `relationship-link.ts` `buildRelationshipNudge`: добавь `typeWeight` в `RelationshipNudge` (interface вверху файла — добавь `typeWeight?: number;`). После `const importance = ...` (выбор человека) дочитай тип выбранного (READ findUnique) и положи typeWeight:

```typescript
    const chosenId = persons.find((p) => p.name === link.personName)?.id;
    let typeWeight: number | undefined;
    if (chosenId) {
      const { personTypeWeight } = await import('../person-types/index.js');
      const ent = await prisma.entity.findUnique({ where: { id: chosenId }, select: { attributes: true } });
      const pt = ((ent?.attributes ?? {}) as Record<string, unknown>).personType;
      typeWeight = personTypeWeight(typeof pt === 'string' ? pt : undefined);
    }
    return {
      personName: link.personName, daysSince: link.daysSince, direction: link.direction,
      description: link.description, importance, insightText, typeWeight,
    };
```
(добавь `typeWeight` в возврат; `prisma` уже импортирован.)

- [ ] **Step 3c: detector** — `detectRelationshipLink` (engine): положи typeWeight в payload ТОЛЬКО при флаге. После `const rn = await buildRelationshipNudge(userId);` и формирования cand.payload, перед `cand.significance = scoreSignificance(cand)`:

```typescript
    if (isV2PersonTypesEnabled(userId) && rn.typeWeight !== undefined) {
      (cand.payload as Record<string, unknown>).typeWeight = rn.typeWeight;
    }
```
(добавь динамический `import { isV2PersonTypesEnabled }` в detectRelationshipLink рядом с isV2RelationshipsEnabled.)

- [ ] **Step 3d: scoreSignificance** — `relationship_link` case: буст с порогом-дефолтом 0.6 (off→0), общий потолок 0.95:

```typescript
    case 'relationship_link': {
      const days = Number(c.payload.daysSince ?? 0);
      const imp = Number(c.payload.importance ?? 5);
      const baseSig = Math.max(0, Math.min(0.85, (days / 30) * (imp / 10)));
      const typeBoost = Math.max(0, (Number(c.payload.typeWeight ?? 0.6)) - 0.6) * 0.3;
      return Math.min(0.95, baseSig + typeBoost);
    }
```

- [ ] **Step 4: Run → pass.** off: typeWeight отсутствует → `?? 0.6` → boost 0 → 0.85 (как было). client → выше.

- [ ] **Step 5: tsc + commit** (`feat(person-types): усиление relationship_link ×тип — буст off-safe (B-T7)`).

---

## Task 8: Полный verify + независимое ревью

- [ ] **Step 1: Полный verify.** `cd packages/server && npx tsc --noEmit && npx vitest run` (unit зелёные) + `npx vitest run --project integration` (зелёные, +4 новых it).

- [ ] **Step 2: commit** если что-то осталось.

- [ ] **Step 3: Независимое ревью** (`pr-review-toolkit:code-reviewer`) на дифф. Фокус:
  - **off=байт-идентично:** при `!isV2PersonTypesEnabled` — детектор person_meeting пуст, врезка null, усиления +0 (порог-дефолты `?? 0.6`/`?? 0.7` дают boost=0 БЕЗ payload.typeWeight — проверить юнитами). relationship/birthday при person-types-off дают РОВНО прежнюю значимость.
  - **READ-ONLY:** no-write-guard покрывает meeting*.ts; buildRelationshipNudge добавил findUnique (READ, не write).
  - **матчер не ложноположит:** «командой»≠«Команда», короткие имена, префикс склонений.
  - **D1-гейт:** бриф только с CRM-контекстом (тип/дело/деньги).
  - **entityId per-meeting:** detectPersonMeeting ставит entityId=человек → cooldown scope per-meeting; significance≥0.8 → severity≥8 → обходит defer.
  - **внутренний CalendarEvent, наш tz:** ни Google, ни серверный UTC; localDateOnlyUTC/localTimeStr.
  - **кросс-домен брифа реальный:** тип+каденс+обязательство+owed из БД.
  - **exhaustiveness:** person_meeting в score/TEMPLATES (tsc+тест).
  - 0 блокеров → доклад Berik + предложить деплой (флаг уже all → деплой активирует).

---

## Self-Review (выполнено)
**Spec coverage:** календарь-бриф #5 (T1-T5 ✓: матчер+тайминг+gather+детектор+врезка), усиления #2/#4 (T6-T7 ✓). **D1** (матч всех + CRM-гейт): meeting-impl ✓. **D2** (консерв.матчер): meeting.ts ✓. **D3** (буст не суппресс, off-safe порог-дефолт): T6/T7 scoreSignificance + off-safe юниты ✓. **D4** (2 слоя): врезка T4 + детектор T3 ✓. **Внутр.календарь+наш tz:** buildPersonMeetingBriefs localDateOnlyUTC/localTimeStr ✓. **Placeholder scan:** полный код. **Type consistency:** `PersonMeetingBrief`/`buildPersonMeetingBriefs`/`matchPersonInText`/`minutesUntil`/`describeMeetingBrief` едины T1↔T2↔T3↔T4; payload-ключи `{insightText,minutesUntil,name}` совпадают детектор↔score↔TEMPLATES; `typeWeight` поле едино birthday/relationship gather↔detector↔score; пороги-дефолты `?? 0.6`(rel)/`?? 0.7`(bday) = off-safe.
