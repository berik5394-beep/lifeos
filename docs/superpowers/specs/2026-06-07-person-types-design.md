# Типы людей (CRM, мост #2) — Design Spec

**Дата:** 2026-06-07
**Мост:** #2 «Люди = актив / CRM-память» — следующий срез (ядро relationship-link + ДР + memorial уже в проде).
**Одобрено Berik 2026-06-07** (вариант B + кросс-пересечения + привязка к ВНУТРЕННЕМУ календарю и нашему tz-времени).
**Scope:** SERVER-only (`packages/server`). READ-ONLY кроме маленькой записи типа. За флагом, off=байт-идентично.

## Проблема / ценность
Деловой живёт на отношениях, но граф из ~122 людей «плоский»: бот не отличает КЛИЕНТА от знакомого.
relationship-link молчит, если у человека нет залогированного обязательства (в проде их 1 на 122) → про
важных контактов без долга бот не напоминает. Тип человека (клиент/партнёр/инвестор/семья/друг) — ОДИН
детерминированный сигнал (`personTypeWeight`), который вплетается в несколько доменов через ЖИВЫХ читателей.

**Принцип (Berik):** кросс-пересечения обязательны и привязаны к НАШЕМУ внутреннему `CalendarEvent` +
нашей real-time базе (`lib/tz.ts`), а НЕ к Google Calendar (внешний аппрув непредсказуем). Внутренний
календарь + хранимый `User.timezone` работают для Telegram уже сейчас.

## Карта кросс-пересечений (это и есть фича)
Захват: `set_person_type` → `Entity.attributes.personType`. Единый вес `personTypeWeight(type)` течёт в:
1. **тип ↔ каденс** *(новый читатель)* — `detectNeglectedKeyPerson`: важный человек застоялся БЕЗ требования обязательства.
2. **тип ↔ обязательство** *(усиливаем shipped relationship-link)* — significance × typeWeight.
3. **тип ↔ ДЕНЬГИ** *(killer; ⬜ моста #1)* — застоявшийся клиент, который ДОЛЖЕН тебе (`Obligation kind='money', owed_to_me`) → сумма в тексте.
4. **тип ↔ ДР/memorial** *(усиливаем shipped)* — ДР клиента/партнёра приоритетнее.
5. **тип ↔ ВНУТРЕННИЙ КАЛЕНДАРЬ + ВРЕМЯ** *(новый читатель)* — ближайшее внутреннее `CalendarEvent` (нечёткий матч на типизированного человека) → микро-бриф перед встречей, тайминг через наш tz-движок. Ноль Google.
6. **enrichment врезка** — «ключевые люди по типам · запущенные · кто должен денег · сегодня встречи с кем».

## Tech stack / дисциплина
Fastify + Prisma6 + Postgres, ESM `.js`, TS strict (no any), vitest (zero vi.mock, `.it.test.ts` real prisma,
структурные тесты readFileSync+grep). Commit-per-step + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
Шаблон кросс-домена = Goal-Impact/Runway/Energy-Link/relationship-link: `детерминированное число → enrichment-врезка → проактивный детектор`.

## Что переиспользуем (НЕ с нуля)
- `getEntityGraph().upsertEntity(userId,{type,name,attributes,importance})` — МЕРЖИТ attributes (как set_birthday).
- `getEntityGraph().staleEntities(userId, sinceDays, minImportance): Entity[]` — застоявшиеся (id,name,type,importance,lastSeenAt,attributes), сорт по importance desc.
- `Obligation{ personEntityId FK, direction, kind('action'|'money'), amount, description, status }`.
- `CalendarEvent{ title, date @db.Date, startTime 'HH:MM', description, source }` — ВНУТРЕННИЙ.
- `lib/tz.ts` real-time: `localDateOnlyUTC(tz)`, `localHour(tz)`, `localNowString(tz)`, `localDayOfWeek(tz)`, `daysUntilMonthEnd`. `getUserTimezone(userId)`.
- `_habit-match.ts`: `normalizeHabit`, `matchHabit` — нечёткий матч (имя человека ↔ title/desc события).
- Shipped детекторы `relationship_link` / `birthday_upcoming` — только домножаем significance (НЕ переписываем).
- Шаблон relationship-link: `services/<dir>/{types,impl,index}` + enrichment-врезка + детектор с ранним флаг-return + флаг-копия + структурный no-write guard.

## Данные
**Без миграции.** Тип хранится в `Entity.attributes.personType: PersonType` (Json-мерж, как `birthday`).
```
type PersonType = 'client' | 'partner' | 'investor' | 'family' | 'friend';
// личное/business-нейтральное «знакомый» = тип НЕ задан (вес 0.6).
```

## Компоненты / файлы (относительно `src/`)
| Файл | Ответственность |
|---|---|
| `services/person-types/types.ts` (create) | Чистые: `personTypeWeight(type?)`, `pickNeglectedKeyPerson`, `describeNeglected`, типы `TypedPerson`/`NeglectedKeyPerson`/`PersonMeetingBrief`. |
| `services/person-types/impl.ts` (create) | `buildNeglectedKeyPerson(userId, now?)` (тип↔каденс↔деньги) + `buildPersonMeetingBriefs(userId, now?)` (тип↔внутр.календарь↔время). READ-ONLY. |
| `services/person-types/index.ts` (create) | re-export. |
| `services/person-types/no-write-guard.test.ts` (create) | grep-гард: ни create/update/delete/upsert/$transaction/raw SQL в impl. |
| `tools/set-person-type.ts` (create) | tool `set_person_type` (пишет Entity.attributes.personType). |
| `lib/feature-flags.ts` (modify) | `isV2PersonTypesEnabled` (env `FEATURE_V2_PERSON_TYPES`), копия `isV2RelationshipsEnabled`. |
| `services/v2-proactivity-engine.ts` (modify) | +2 источника `neglected_key_person`, `person_meeting` (NudgeSource/score/TEMPLATES/детекторы/регистрация); +домножение `relationship_link`/`birthday_upcoming` на `payload.typeWeight ?? 1`. |
| `services/v2-enrichment.ts` (modify) | флаг-гейтнутый fetch + поле `personTypes: string\|null` + рендер секции. |

## Чистые формулы (`types.ts`)
```
function personTypeWeight(type?: string): number
  // client 1.0 · investor 0.95 · partner 0.9 · family 0.7 · friend 0.55 · undefined/прочее 0.6
  // ЕДИНСТВЕННЫЙ источник веса. Детерминированно.

type TypedPerson = { id; name; type?: PersonType; importance; daysSince };  // daysSince = floor((now-lastSeenAt)/DAY), ≥1
type OwedMoney = { amount: number };  // owed_to_me money по personEntityId, если есть
type NeglectedKeyPerson = { name; type?; daysSince; weightedScore; owed?: number };

pickNeglectedKeyPerson(persons: TypedPerson[], owedByEntity: Record<string,number>): NeglectedKeyPerson | null
  // weightedScore = (daysSince/14) * personTypeWeight(type) * (importance/10)
  // берём max weightedScore; ГЕЙТ: только если есть ХОТЯ БЫ один типизированный человек
  // (type задан) ИЛИ importance≥7 — иначе null (не нудим про случайных знакомых).
  // owed = owedByEntity[id] если есть.

describeNeglected(p): string
  // деньги-aware: с owed → «🤝 [{typeLabel}] {name}: {daysSince} дн без контакта, должен тебе {owed}₸. Напомнить?»
  // без owed → «🤝 [{typeLabel}] {name}: {daysSince} дн без контакта. Написать?»
```

## Детектор 1 — `detectNeglectedKeyPerson` (тип↔каденс↔деньги)
1. ранний `if(!isV2PersonTypesEnabled(userId)) return []`.
2. `stale = staleEntities(userId, 14, 5).filter(type==='person')` → `TypedPerson[]` (type из `attributes.personType`).
3. `owed` = `prisma.obligation.findMany({where:{userId,status:'open',kind:'money',direction:'owed_to_me',personEntityId:{in: staleIds}}})` → `Record<entityId, sum(amount)>`.
4. `pickNeglectedKeyPerson` → candidate `neglected_key_person`, payload `{name,type,daysSince,owed,weightedScore}`, toneHint по типу (business→curious, family/friend→gentle).
5. `scoreSignificance` (case `neglected_key_person`): `Math.min(0.9, Math.min(0.85, weightedScore) + (Number(c.payload.owed ?? 0) > 0 ? 0.1 : 0))` — деньги-долг поднимает приоритет, общий потолок 0.9. (Кто ниже gate3=0.6 не доходит проактивно, но виден во врезке.)
6. try/catch → [].

## Детектор 2 — `detectPersonMeeting` (тип↔ВНУТРЕННИЙ календарь↔ВРЕМЯ)
1. ранний флаг-return.
2. `tz = getUserTimezone(userId)`; `today = localDateOnlyUTC(tz)`; события: `prisma.calendarEvent.findMany({where:{userId, date: today}})` (ВНУТРЕННИЕ, любой source).
3. Для каждого события нечётким матчем (`matchHabit(personName, [{id,name:event.title+' '+event.description}])` инверсно — ищем имя человека в title/desc) сопоставляем типизированного человека из его сущностей.
4. Гейт времени: событие ещё не прошло (`event.startTime` > `localHour:localMinute` сегодня) И в ближайшем окне (по startTime). Тайминг ТОЛЬКО через `lib/tz.ts` (наш «сейчас»), не сервер.
5. Бриф: `PersonMeetingBrief{ name,type,startTime, lastContactDays, openObligation?, owed? }` → текст «Сегодня {startTime} — [{typeLabel}] {name}. Последний контакт {lastContactDays} дн, открыто: {desc}{, должен тебе {owed}₸}».
6. candidate `person_meeting`, significance ~ от близости времени + typeWeight (cap 0.85). try/catch → [].

## Усиления shipped-читателей (off-safe, ×typeWeight)
- `relationship_link`: его gather (`buildRelationshipNudge`) дочитывает `personType` выбранного человека → payload `typeWeight`. `scoreSignificance` case: `Math.min(0.85,(days/30)*(imp/10) * (c.payload.typeWeight ?? 1))`.
- `birthday_upcoming`: gather дочитывает personType → payload `typeWeight`. case: `Math.min(1, base+(imp-5)*0.03 + Math.max(0,(c.payload.typeWeight ?? 1)-0.7)*0.2)` (только БУСТ business-типов; друг/семья не понижаются).
- **off-гарантия:** при `!isV2PersonTypesEnabled` ИЛИ типе не заданном — `payload.typeWeight` отсутствует → `?? 1` → значение БАЙТ-идентично текущему. Структурный тест это фиксирует.

## Enrichment врезка (`v2-enrichment.ts`)
За `isV2PersonTypesEnabled`: `personTypes: string|null` = «👥 Ключевые: клиенты N (запущено M), партнёры…; должны тебе: {name} {amount}; сегодня встреча: {startTime} {name}». Мозг отвечает «кому из клиентов написать / кто не платит / с кем сегодня встреча». off → null (секции нет).

## Захват — `set_person_type` (`tools/set-person-type.ts`)
Зеркало `set_birthday`: `category:'memory'`, aliases `{name/personName→person}`, schema `{person:string, type: z.enum(['client','partner','investor','family','friend'])}` (+ рус-алиасы «клиент/партнёр/инвестор/семья/друг» в нормализаторе), `needsConfirm:false`, `sideEffects:'write'`. handler: `upsertEntity(userId,{type:'person', name:person, attributes:{personType:type} as any, importance})` (мерж не затирает birthday). Idempotent на каноничном имени. Money-safety: ноль денег. Регистрация в `tools/index.ts`.

## Флаг + безопасность
`isV2PersonTypesEnabled` (env `FEATURE_V2_PERSON_TYPES`). **READ-ONLY** во всём, кроме `set_person_type` (запись 1 атрибута памяти, как set_birthday). Структурный no-write guard на `services/person-types`. Тайминг — ТОЛЬКО `lib/tz.ts`. Off → enrichment null, детекторы ранним return пусты, усиления ×1 (байт-идентично).

## Обработка ошибок / край
- Все `build*` + детекторы try/catch → null/[]. enrichment best-effort (orchestrator withTimeout).
- Нет типизированных людей → детектор 1 null (молчим). Нет событий сегодня / матча → детектор 2 null.
- Событие без матча на человека → игнор (v1: только нечёткий матч имени из title/desc).
- Obligation без personEntityId → не попадает (как в shipped relationship-link).

## Тестирование
- **Pure (TDD):** `personTypeWeight` (все типы + undefined=0.6); `pickNeglectedKeyPerson` (типизированный выбран; importance-гейт; owed в payload; max по weightedScore; null когда некого); `describeNeglected` (с/без owed); off-safe значения significance ×typeWeight (1 при unset).
- **it (real prisma):** `person-types.it.test.ts` — Entity person с personType+давним lastSeenAt → `buildNeglectedKeyPerson` верный; +owed_to_me money obligation → сумма в payload; cross-user; внутренний CalendarEvent сегодня с именем человека в title → `buildPersonMeetingBriefs` находит бриф (tz-aware «сегодня»); off-флаг → пусто.
- **Структурный:** флаг; 2 источника в union/score/TEMPLATES/detectCandidates; усиления `relationship_link`/`birthday_upcoming` содержат `typeWeight ?? 1`; врезка; no-write guard; set_person_type зарегистрирован.
- Baseline unit ~2616 + integration ~126 зелёные; tsc чисто.

## Scope / возможный сплит на плане
Срез крупнее relationship-link. На writing-plans, вероятно, **2 плана** (общий `set_person_type`+`personTypeWeight` идёт в первый):
- **План A — люди-сторона:** set_person_type + personTypeWeight + detectNeglectedKeyPerson (деньги-aware) + усиления relationship_link/birthday + врезка (люди). Самоценно.
- **План B — календарь-бриф:** detectPersonMeeting (тип↔внутр.CalendarEvent↔время) + врезка (встречи). Зависит от A (personTypeWeight + типы).
Решение о сплите — в начале writing-plans.

## Не-цели (v1)
Авто-инференс типа из разговора (только явный tool сейчас); Google Calendar (только внутренний CalendarEvent); понятие «сделка»/deal-pipeline; обязательства по имени без FK; многосвязный граф-обход; вторая+ встреча/перенос. Всё — потом.

## Rollout
Коммит на шаг. Push/deploy/флаг — ТОЛЬКО по слову Berik; флаг сначала на Berik, потом all. SMOKE: «Ахмет — мой клиент» → завести obligation owed_to_me money на него + сделать lastSeenAt давним → боту «кому из клиентов написать?» → ответ с типом+суммой; внутреннее событие сегодня с именем → бриф.
