# Real-Time Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Телефон шлёт настоящий IANA-пояс → сервер хранит в `User.timezone` (авто на перелёте) → ИИ+инструменты+мозг работают в настоящем локальном «сейчас». Фикс живого бага `getTimeOfDay` (UTC). За флагом `FEATURE_V2_REALTIME`, off=байт-идентично.

**Architecture:** device `expo-localization` (sync) → `X-Timezone` header каждый запрос → Fastify preHandler хук (validate + update-on-change, in-mem cache) → `User.timezone` единый источник → `getTimeOfDay(tz)` + блок «СЕЙЧАС» в системный промпт.

**Tech Stack:** Fastify+Prisma6+Postgres (ESM `.js`, TS strict, vitest zero vi.mock, structural tests readFileSync+grep), Expo SDK 54 (fetch-обёртка). Commit-per-step trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Baseline ~2524 теста зелёные.

---

## File Structure
- `packages/server/src/lib/tz.ts` — +`DEFAULT_TZ`, `isValidIanaTz`, `localNowString` (чистые).
- `packages/server/src/lib/feature-flags.ts` — +`isV2RealtimeEnabled`.
- `packages/server/src/ai/jarvis-prompt.ts` — `getTimeOfDay(tz?)` fix + блок СЕЙЧАС + opts.nowTz.
- `packages/server/src/services/assistant-service.ts` — флаг-гейт → opts.nowTz.
- `packages/server/src/middleware/tz-capture.ts` (новый) + `src/index.ts` — хук.
- `apps/mobile/services/device-tz.ts` (новый) + `apps/mobile/services/api.ts` — header.

---

### Task 1: `isValidIanaTz` + `DEFAULT_TZ` (lib/tz.ts)
**Files:** Modify `packages/server/src/lib/tz.ts`; Test `packages/server/src/lib/tz.test.ts` (append).

- [ ] **Step 1: failing test** — append:
```ts
describe('isValidIanaTz', () => {
  it('valid IANA → true', () => {
    expect(isValidIanaTz('Asia/Almaty')).toBe(true);
    expect(isValidIanaTz('Europe/Istanbul')).toBe(true);
    expect(isValidIanaTz('UTC')).toBe(true);
  });
  it('garbage → false', () => {
    expect(isValidIanaTz('Mars/Phobos')).toBe(false);
    expect(isValidIanaTz('')).toBe(false);
    expect(isValidIanaTz('+05:00')).toBe(false);
  });
});
```
- [ ] **Step 2: red** — `npx vitest run src/lib/tz.test.ts` → fail (isValidIanaTz undefined).
- [ ] **Step 3: impl** — in tz.ts add near top exports:
```ts
export const DEFAULT_TZ = 'Asia/Almaty';

export function isValidIanaTz(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```
- [ ] **Step 4: green** — `npx vitest run src/lib/tz.test.ts`.
- [ ] **Step 5: tsc** — `npx tsc --noEmit`.
- [ ] **Step 6: commit** — `feat(tz): isValidIanaTz + DEFAULT_TZ helper`.

---

### Task 2: `localNowString(tz, at?)` (lib/tz.ts)
**Files:** Modify `lib/tz.ts`; Test `lib/tz.test.ts`.

- [ ] **Step 1: failing test**
```ts
describe('localNowString', () => {
  const at = new Date('2026-06-06T14:42:00Z'); // 19:42 Almaty
  it('Almaty форматирует локально', () => {
    const s = localNowString('Asia/Almaty', at);
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/19:42/);
  });
  it('другой пояс — другое время того же инстанта', () => {
    expect(localNowString('Europe/Istanbul', at)).toMatch(/17:42/); // UTC+3
  });
  it('невалидный tz не бросает (safeTz→UTC)', () => {
    expect(() => localNowString('X/Y', at)).not.toThrow();
  });
});
```
- [ ] **Step 2: red.**
- [ ] **Step 3: impl** — use existing `safeTz`:
```ts
export function localNowString(tz: string | null | undefined, at: Date = new Date()): string {
  const zone = safeTz(tz);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone, weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
}
```
- [ ] **Step 4: green.** **Step 5: tsc.** **Step 6: commit** — `feat(tz): localNowString — локальная дата+время строкой`.

---

### Task 3: `isV2RealtimeEnabled` flag (feature-flags.ts)
**Files:** Modify `packages/server/src/lib/feature-flags.ts`; Test `feature-flags.test.ts`.

- [ ] **Step 1: failing test** (mirror existing flag tests):
```ts
describe('isV2RealtimeEnabled', () => {
  const KEY = 'FEATURE_V2_REALTIME';
  afterEach(() => { delete process.env[KEY]; });
  it('all → true', () => { process.env[KEY] = 'all'; expect(isV2RealtimeEnabled('u1')).toBe(true); });
  it('unset → false', () => { expect(isV2RealtimeEnabled('u1')).toBe(false); });
  it('user-list', () => { process.env[KEY] = 'user-u1'; expect(isV2RealtimeEnabled('u1')).toBe(true); expect(isV2RealtimeEnabled('u2')).toBe(false); });
});
```
- [ ] **Step 2: red.**
- [ ] **Step 3: impl** — mirror `isV2InlineNudgeEnabled`:
```ts
/** Real-time foundation — per-user gate. off = байт-идентично (хук no-op, getTimeOfDay старый, без блока СЕЙЧАС). */
export function isV2RealtimeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_REALTIME, userId);
}
```
- [ ] **Step 4: green. Step 5: tsc. Step 6: commit** — `feat(flag): isV2RealtimeEnabled (FEATURE_V2_REALTIME)`.

---

### Task 4: `getTimeOfDay(tz?, d?)` fix + opts.nowTz threading (jarvis-prompt.ts)
**Files:** Modify `packages/server/src/ai/jarvis-prompt.ts`; Test `jarvis-prompt.test.ts`.
**Context:** current `getTimeOfDay(d = new Date())` at :92-98 uses `d.getHours()` (server UTC). Callers at :158 (renderContext) and :267 (buildJarvisPrompt core).

- [ ] **Step 1: failing test** — the bug regression:
```ts
describe('getTimeOfDay(tz)', () => {
  const at = new Date('2026-06-06T14:00:00Z'); // 19:00 Almaty, 14:00 UTC
  it('БАГ-регресс: Almaty 19:00 → вечер (НЕ день)', () => {
    expect(getTimeOfDay('Asia/Almaty', at)).toBe('вечер');
  });
  it('без tz → старое серверное поведение (UTC час)', () => {
    expect(getTimeOfDay(undefined, at)).toBe(getTimeOfDay(undefined, at)); // 14:00 UTC → день
  });
});
```
- [ ] **Step 2: red** (getTimeOfDay not exported / wrong arity). Export it if needed.
- [ ] **Step 3: impl** — change signature + use `localHour`:
```ts
import { localHour } from '../lib/tz.js';
export function getTimeOfDay(tz?: string, d: Date = new Date()): 'утро' | 'день' | 'вечер' | 'ночь' {
  const h = tz ? localHour(tz, d) : d.getHours();
  if (h >= 5 && h < 12) return 'утро';
  if (h >= 12 && h < 17) return 'день';
  if (h >= 17 && h < 23) return 'вечер';
  return 'ночь';
}
```
Add `nowTz?: string` to the buildJarvisPrompt opts type. Update call sites: `:267` `core(ctx.userName, getTimeOfDay(opts?.nowTz))`; `:158` renderContext uses `getTimeOfDay(opts?.nowTz)` (thread opts/nowTz into renderContext signature). **При `nowTz===undefined` → старое поведение (байт-идентично).**
- [ ] **Step 4: green. Step 5: tsc** (fix any caller arity). **Step 6: commit** — `fix(prompt): getTimeOfDay(tz) — время суток в поясе юзера, не UTC сервера`.

---

### Task 5: блок «СЕЙЧАС» в core() когда nowTz задан (jarvis-prompt.ts)
**Files:** Modify `jarvis-prompt.ts`; Test `jarvis-prompt.test.ts`.

- [ ] **Step 1: failing test**
```ts
describe('buildJarvisPrompt — блок СЕЙЧАС', () => {
  const ctx = /* минимальный валидный AssistantContext */;
  it('nowTz задан → промпт содержит СЕЙЧАС + локальное', () => {
    const p = buildJarvisPrompt(ctx, { nowTz: 'Asia/Almaty', _now: new Date('2026-06-06T14:42:00Z') });
    expect(p).toMatch(/СЕЙЧАС/);
    expect(p).toMatch(/19:42/);
    expect(p).toMatch(/Asia\/Almaty/);
  });
  it('nowTz НЕ задан → нет блока СЕЙЧАС (байт-идентично)', () => {
    const p = buildJarvisPrompt(ctx, {});
    expect(p).not.toMatch(/СЕЙЧАС/);
  });
});
```
- [ ] **Step 2: red.**
- [ ] **Step 3: impl** — in `core()` (or buildJarvisPrompt body), when `nowTz` present, prepend:
```ts
const nowBlock = opts?.nowTz
  ? `СЕЙЧАС: ${localNowString(opts.nowTz, opts._now)} — ${getTimeOfDay(opts.nowTz, opts._now)}. Пояс: ${opts.nowTz}.\nПри словах «сегодня/завтра/вчера» сверяйся с этим временем, не выдумывай.\n\n`
  : '';
```
Insert `nowBlock` at the very start of the assembled core string. Add optional `_now?: Date` to opts (test-injection of instant; defaults to `new Date()`).
- [ ] **Step 4: green. Step 5: tsc. Step 6: commit** — `feat(prompt): впрыск блока СЕЙЧАС (локальное время) когда realtime ON`.

---

### Task 6: assistant-service флаг-гейт → opts.nowTz
**Files:** Modify `packages/server/src/services/assistant-service.ts`; Test `assistant-service` behavioral.
**Context:** `tz` резолвится на :75; `buildJarvisPrompt(...)` на :293.

- [ ] **Step 1: failing test** — behavioral (реальный gather→build, реальный prisma user с timezone):
```ts
it('realtime ON → системный промпт содержит СЕЙЧАС в поясе юзера', async () => {
  process.env.FEATURE_V2_REALTIME = 'all';
  // создать user с timezone='Asia/Almaty', прогнать построение промпта
  // assert prompt содержит 'СЕЙЧАС' и 'Asia/Almaty'
});
it('realtime OFF → нет блока СЕЙЧАС', async () => { /* flag unset */ });
```
- [ ] **Step 2: red.**
- [ ] **Step 3: impl** — at :293 build opts:
```ts
import { isV2RealtimeEnabled } from '../lib/feature-flags.js';
const nowTz = isV2RealtimeEnabled(userId) ? tz : undefined;
const systemPrompt = buildJarvisPrompt(gathered.context, { /* ...existing... */, nowTz });
```
- [ ] **Step 4: green. Step 5: tsc. Step 6: commit** — `feat(assistant): realtime флаг → nowTz в промпт`.

---

### Task 7: tz-capture middleware + проводка (index.ts)
**Files:** Create `packages/server/src/middleware/tz-capture.ts`; Modify `packages/server/src/index.ts`; Test `tz-capture.it.test.ts` (integration, реальный test-app + prisma).
**Context:** auth ставит `request.userId` (`middleware/auth.ts:20`). Хуки в index.ts (`:170` onRequest globalApiLimiter).

- [ ] **Step 1: failing test** — behavioral .it.test:
```ts
// header X-Timezone=Europe/Istanbul + флаг all → User.timezone обновлён
// тот же tz снова → НЕТ второй записи (cache) [проверка updatedAt не изменился ИЛИ счётчик]
// невалидный 'X/Y' → User.timezone не тронут
// флаг off → no-op
// cross-user: хук юзера A не трогает B
```
- [ ] **Step 2: red.**
- [ ] **Step 3: impl** — `tz-capture.ts`:
```ts
import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { isValidIanaTz } from '../lib/tz.js';
import { isV2RealtimeEnabled } from '../lib/feature-flags.js';

const lastTz = new Map<string, string>();

export async function tzCaptureHook(request: FastifyRequest): Promise<void> {
  try {
    const userId = request.userId;
    if (!userId || !isV2RealtimeEnabled(userId)) return;
    const tz = request.headers['x-timezone'];
    if (typeof tz !== 'string' || !isValidIanaTz(tz)) return;
    if (lastTz.get(userId) === tz) return;          // cache: write only on change
    lastTz.set(userId, tz);
    await prisma.user.update({ where: { id: userId }, data: { timezone: tz } });
  } catch (err) {
    console.warn('[tz-capture] best-effort failed:', err instanceof Error ? err.message : err);
  }
}
```
Wire in index.ts AFTER auth runs (per-route `preHandler` chain, или глобально вторым хуком после auth-декоратора). Place so `request.userId` is populated. Хук best-effort, никогда не reply.
- [ ] **Step 4: green. Step 5: tsc + full suite** `npx vitest run`. **Step 6: commit** — `feat(tz): preHandler хук — X-Timezone → User.timezone (флаг-гейт, cache, best-effort)`.

---

### Task 8: mobile `getDeviceTimezone()` util + dep
**Files:** Create `apps/mobile/services/device-tz.ts`; Modify `apps/mobile/package.json` (via `npx expo install expo-localization`); Test `apps/mobile/services/device-tz.test.ts` (если есть jest/настройка) ИЛИ структурный.

- [ ] **Step 1:** `cd apps/mobile && npx expo install expo-localization` (SDK-correct версия). При необходимости — Expo MCP-плагин для проверки версии.
- [ ] **Step 2: impl** — `device-tz.ts`:
```ts
import { getCalendars } from 'expo-localization';

/** Настоящий IANA-пояс устройства (синхронно, всегда свежо → travel-safe). */
export function getDeviceTimezone(): string {
  try {
    const tz = getCalendars()?.[0]?.timeZone;
    if (tz) return tz;
  } catch { /* fallthrough */ }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch { /* fallthrough */ }
  return 'UTC';
}
```
- [ ] **Step 3: tsc** (`cd apps/mobile && npx tsc --noEmit` если настроено). **Step 4: commit** — `feat(mobile): getDeviceTimezone() через expo-localization`.

---

### Task 9: mobile `X-Timezone` header (api.ts)
**Files:** Modify `apps/mobile/services/api.ts` (header builder :133-142).

- [ ] **Step 1: impl** — после блока Authorization (после :142) добавить:
```ts
import { getDeviceTimezone } from './device-tz';
// ...внутри сборки headers, для каждого запроса:
headers['X-Timezone'] = getDeviceTimezone();
```
- [ ] **Step 2:** структурный тест/проверка: `api.ts` содержит `X-Timezone` и импорт `getDeviceTimezone` (если есть тестовая инфра мобайла) — иначе ручная сверка + tsc.
- [ ] **Step 3: tsc. Step 4: commit** — `feat(mobile): X-Timezone header на каждый запрос`.

---

### Task 10: финальная верификация + независимое ревью
- [ ] `cd packages/server && npx tsc --noEmit && npx vitest run` — всё зелёное (baseline +новые).
- [ ] Контроль байт-идентичности off: с unset `FEATURE_V2_REALTIME` промпт без блока СЕЙЧАС, `getTimeOfDay()` старый, хук no-op.
- [ ] Независимое ревью (pr-review-toolkit:code-reviewer) на диффе: фокус — off=identical, флаг-гейт во всех 3 точках (хук/getTimeOfDay/блок), best-effort хук не блокирует, cache против write-storm, cross-user, валидация tz.
- [ ] Доклад Berik + предложить rollout (флаг user-berik → проверка Telegram → all; мобайл с APK).

## Rollout
Commit-per-step локально. Push/deploy/флаг — ТОЛЬКО по слову Berik. Флаг старт off → `user-<berik>` → проверка в Telegram (бот скажет верное «вечер»/дату) → `all`. Мобайл-часть активна со следующей APK-сборкой.
