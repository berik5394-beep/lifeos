# Voice-One-Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка микрофона на дашборде/в задачах/в привычках исполняет команды через единый мозг (`handleMessage`), деньги подтверждаются кнопками или голосом, мобилка ничего не исполняет сама.

**Architecture:** Сервер: `POST /voice/process` → `handleMessage(userId, text, 'voice')`, ответ `{intent, response, pendingAction, confirmationText}`; `ai/voice-pipeline.ts` удаляется. Мобилка: чистый модуль `services/voice-followup.ts` решает «подтвердить или готово»; `use-voice` озвучивает ответ сервера и показывает Alert подтверждения; экраны на новый `lastResult` вызывают свой `handleRefresh`; чат — режим `transcribeOnly` + кнопки подтверждения в сообщениях.

**Tech Stack:** Fastify + Prisma + vitest (unit/integration на реальной Postgres), React Native + Expo + zustand + jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-11-05-voice-one-brain-design.md`

**Команды:**
- Сервер unit: `cd packages/server && npx vitest run --project unit <file>`
- Сервер integration (нужен docker test-db: `npm run test:db:up`): `cd packages/server && npx vitest run --project integration <file>`
- Сервер типы: `cd packages/server && npx tsc --noEmit -p .`
- Мобилка jest: `cd apps/mobile && npx jest <file>`
- Мобилка типы: `cd apps/mobile && npx tsc --noEmit -p .`

---

## File Structure

| Файл | Ответственность | Действие |
|---|---|---|
| `packages/server/src/routes/voice.ts` | `/voice/process` → handleMessage | Modify |
| `packages/server/src/ai/voice-pipeline.ts` | старые шаблоны + «unknown→задача» | Delete |
| `packages/server/src/routes/voice-process.it.test.ts` | поведение роута на реальной БД | Create |
| `packages/server/src/routes/voice-safety.test.ts` | структурный гард делегирования | Rewrite |
| `packages/server/src/ai/intent-tz-wiring.test.ts` | убрать 2 кейса про voice-pipeline | Modify |
| `apps/mobile/services/voice-followup.ts` | `planVoiceFollowUp`, `confirmPendingVoiceAction` | Create |
| `apps/mobile/__tests__/services/voice-followup.test.ts` | jest для модуля | Create |
| `apps/mobile/hooks/use-voice.ts` | озвучка ответа сервера, Alert подтверждения, `transcribeOnly` | Modify |
| `apps/mobile/app/(tabs)/index.tsx`, `tasks.tsx`, `habits.tsx` | убрать автоисполнение, рефреш на `lastResult` | Modify |
| `apps/mobile/stores/chat-store.ts` | `pendingAction` в сообщении + `confirmPendingAction` | Modify |
| `apps/mobile/__tests__/stores/chat-store.test.ts` | jest для стора | Create |
| `apps/mobile/app/(tabs)/chat.tsx` | `transcribeOnly`, кнопки «Записать / Отмена» | Modify |

---

### Task 1: Сервер — падающие тесты на `/voice/process` через мозг

**Files:**
- Create: `packages/server/src/routes/voice-process.it.test.ts`
- Rewrite: `packages/server/src/routes/voice-safety.test.ts`

- [ ] **Step 1: Integration-тест (реальная БД, детерминированные фразы без LLM)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { voiceRoutes } from './voice.js';
import { chatRoutes } from './chat.js';
import { civilDayRefs } from '../lib/tz.js';

/**
 * voice-one-brain: голосовая кнопка мобилки (/voice/process) идёт через
 * handleMessage — деньги ждут подтверждения, задачи пишет сервер, кризис
 * отвечает safety-текстом. Раньше: parseIntent + шаблон, мобилка исполняла
 * сама (деньги без «да», «unknown → задача»).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([voiceRoutes, chatRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function authed(label: string, timezone = 'Asia/Almaty') {
  const u = await prisma.user.create({
    data: { email: `vp-${label}-${Date.now()}@a.test`, name: 'V', passwordHash: 'x', timezone },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const say = (headers: Record<string, string>, text: string) =>
  app.inject({ method: 'POST', url: '/voice/process', headers, payload: { text } });

describe('/voice/process → единый мозг', () => {
  it('расход: НЕ пишется сразу (pendingAction), пишется после подтверждения', async () => {
    const { userId, headers } = await authed('exp');
    const res = await say(headers, 'Потратил 3000 на еду');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      intent: { action: string };
      response: string;
      pendingAction: { action: string } | null;
      confirmationText: string | null;
    };
    expect(body.pendingAction?.action).toBe('add_expense');
    expect(body.confirmationText).toBeTruthy();
    expect(body.response).toBe(body.confirmationText);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);

    const ok = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
  });

  it('отмена: расход не пишется', async () => {
    const { userId, headers } = await authed('cancel');
    await say(headers, 'Потратил 500 на такси');
    const no = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: false } });
    expect(no.statusCode).toBe(200);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
  });

  it('задача: пишет СЕРВЕР, на локальное «завтра» юзера; без pendingAction', async () => {
    const { userId, headers } = await authed('task');
    const res = await say(headers, 'Создай задачу купить хлеб завтра');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { intent: { action: string }; pendingAction: unknown };
    expect(body.intent.action).toBe('create_task');
    expect(body.pendingAction).toBeNull();
    const task = await prisma.task.findFirstOrThrow({ where: { userId } });
    expect(task.date.toISOString().slice(0, 10)).toBe(civilDayRefs('Asia/Almaty').tomorrow);
  });

  it('кризис: safety-ответ, ничего не создано', async () => {
    const { userId, headers } = await authed('crisis');
    const res = await say(headers, 'Не хочу больше жить');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { intent: { action: string } }).intent.action).toBe('safety_crisis');
    expect(await prisma.task.count({ where: { userId } })).toBe(0);
  });
});
```

- [ ] **Step 2: Переписать структурный гард `voice-safety.test.ts` целиком**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * voice-one-brain (2026-11-05): /voice/process ЦЕЛИКОМ идёт через
 * handleMessage (safety-гейт первым, confirm-FSM, реестр, память).
 * Раньше — отдельная crisis-ветка + processVoiceCommand (второй мозг).
 */
const SRC = readFileSync(join(process.cwd(), 'src/routes/voice.ts'), 'utf-8');

function processBlock(): string {
  const start = SRC.indexOf("app.post('/voice/process'");
  const end = SRC.indexOf("app.post('/voice/assistant'");
  expect(start, 'роут /voice/process').toBeGreaterThan(-1);
  expect(end, 'роут /voice/assistant ниже').toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('voice-safety — /voice/process через единый мозг', () => {
  it('делегирует handleMessage(userId, text, "voice")', () => {
    expect(processBlock()).toMatch(/handleMessage\(userId,\s*text,\s*['"]voice['"]\)/);
  });
  it('старого второго мозга нет: processVoiceCommand/parseIntent не используются', () => {
    expect(SRC).not.toMatch(/processVoiceCommand|voice-pipeline/);
    expect(processBlock()).not.toMatch(/parseIntent/);
    expect(existsSync(join(process.cwd(), 'src/ai/voice-pipeline.ts'))).toBe(false);
  });
  it('mobile-shape сохранён + поля подтверждения', () => {
    const block = processBlock();
    expect(block).toMatch(/intent:\s*\{\s*action:/);
    expect(block).toMatch(/response:/);
    expect(block).toMatch(/pendingAction:/);
    expect(block).toMatch(/confirmationText:/);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `cd packages/server && npx vitest run --project unit src/routes/voice-safety.test.ts && npx vitest run --project integration src/routes/voice-process.it.test.ts`
Expected: FAIL — гард видит `processVoiceCommand`; it-тест «расход» получает `pendingAction: undefined` (старый пайплайн), «задача» не находит Task в БД (старый путь не пишет).

### Task 2: Сервер — реализация и удаление voice-pipeline

**Files:**
- Modify: `packages/server/src/routes/voice.ts` (импорты 10, 23-24; блок `/voice/process` ~59-92)
- Delete: `packages/server/src/ai/voice-pipeline.ts`
- Modify: `packages/server/src/ai/intent-tz-wiring.test.ts` (удалить кейсы `voice-pipeline: …` и `routes/voice: processVoiceCommand …`)

- [ ] **Step 1: Заменить тело `/voice/process`**

```ts
  app.post('/voice/process', {
    preHandler: [processRateLimit, aiDailyLimiter, validate(voiceSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof voiceSchema>;
    const userId = request.userId;

    try {
      // voice-one-brain (2026-11-05): голосовая кнопка мобилки — ТОТ ЖЕ мозг,
      // что Telegram/чат: safety-гейт первым, confirm-FSM для денег, реестр
      // инструментов с ToolCall-аудитом, честные матчеры, память. Раньше тут
      // был второй мозг (parseIntent + шаблон «Задача создана»), а мобилка
      // исполняла интент сама — деньги без «да», «непонятное → задача».
      const jarvis = await handleMessage(userId, text, 'voice');
      let response = jarvis.reply;
      if (jarvis.bookingUrl) response += `\n\n\u{1F517} ${jarvis.bookingUrl}`;
      return reply.send({
        intent: { action: jarvis.intent },
        response,
        pendingAction: jarvis.pendingAction ?? null,
        confirmationText: jarvis.confirmationText ?? null,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        message: 'Ошибка обработки голосовой команды',
      });
    }
  });
```

Удалить импорты `processVoiceCommand` (строка 10) и, если больше не используются в файле, `matchesCrisisPhrase` и `getUserTimezone` (проверить `grep -n "matchesCrisisPhrase\|getUserTimezone" src/routes/voice.ts`). Если у `JarvisResponse` нет поля `confirmationText` — проверить `grep -n "confirmationText" src/services/jarvis-orchestrator.ts` (оркестратор возвращает его в pending-ветках); при отсутствии в интерфейсе — добавить `confirmationText?: string;` в `JarvisResponse`.

- [ ] **Step 2: Удалить `src/ai/voice-pipeline.ts` и 2 кейса в `intent-tz-wiring.test.ts`**

```bash
cd packages/server && git rm src/ai/voice-pipeline.ts
```
В `src/ai/intent-tz-wiring.test.ts` удалить блоки `it('voice-pipeline: fallback-задача и parseIntent — в поясе юзера', …)` и `it('routes/voice: processVoiceCommand получает пояс юзера', …)`.

- [ ] **Step 3: Прогон**

Run: `cd packages/server && npx tsc --noEmit -p . && npx vitest run --project unit src/routes/voice-safety.test.ts src/ai/intent-tz-wiring.test.ts && npx vitest run --project integration src/routes/voice-process.it.test.ts`
Expected: tsc 0 ошибок; все PASS.

- [ ] **Step 4: Полный серверный прогон**

Run: `cd packages/server && npx vitest run --project unit && npx vitest run --project integration`
Expected: unit всё зелёное; integration — всё зелёное, кроме известного пред-существующего `buildGoalHabitHealth ловит буксующую цель`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/voice.ts packages/server/src/routes/voice-safety.test.ts packages/server/src/routes/voice-process.it.test.ts packages/server/src/ai/intent-tz-wiring.test.ts packages/server/src/services/jarvis-orchestrator.ts
git commit -m "fix(voice): /voice/process через единый мозг (handleMessage) — деньги с подтверждением, без второго пайплайна"
```

### Task 3: Мобилка — модуль `voice-followup` (TDD)

**Files:**
- Create: `apps/mobile/services/voice-followup.ts`
- Test: `apps/mobile/__tests__/services/voice-followup.test.ts`

- [ ] **Step 1: Падающий тест**

```ts
import { api } from '@/services/api';
import { planVoiceFollowUp, confirmPendingVoiceAction, isConfirmable } from '@/services/voice-followup';

const mockApi = api as jest.Mocked<typeof api>;

describe('planVoiceFollowUp', () => {
  it('pendingAction → confirm с текстом сервера', () => {
    expect(
      planVoiceFollowUp({
        intent: { action: 'add_expense' },
        response: 'Записать расход 3000₸ на еду?',
        pendingAction: { action: 'add_expense', input: { amount: 3000 } },
        confirmationText: 'Записать расход 3000₸ на еду?',
      }),
    ).toEqual({ kind: 'confirm', text: 'Записать расход 3000₸ на еду?' });
  });
  it('pendingAction без текста → дефолтный вопрос', () => {
    expect(planVoiceFollowUp({ pendingAction: { action: 'add_income', input: {} } })).toEqual({
      kind: 'confirm',
      text: 'Подтвердить действие?',
    });
  });
  it('слот-вопрос «На что потратил?» (__awaitingCategory/__awaitingSource) → done: отвечают голосом, не кнопкой', () => {
    expect(
      planVoiceFollowUp({
        response: 'На что потратил 3000₸? (или «отмена»)',
        pendingAction: { action: 'add_expense', input: { amount: 3000, __awaitingCategory: true } },
        confirmationText: 'На что потратил 3000₸? (или «отмена»)',
      }),
    ).toEqual({ kind: 'done' });
    expect(isConfirmable({ action: 'add_income', input: { amount: 1, __awaitingSource: true } })).toBe(false);
    expect(isConfirmable({ action: 'add_income', input: { amount: 1, source: 'зп' } })).toBe(true);
  });
  it('без pendingAction → done', () => {
    expect(planVoiceFollowUp({ intent: { action: 'create_task' }, response: 'Задача создана', pendingAction: null })).toEqual({
      kind: 'done',
    });
  });
});

describe('confirmPendingVoiceAction', () => {
  beforeEach(() => jest.clearAllMocks());
  it('200 → текст и интент сервера, шлёт confirm на /voice/confirm-action', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Записал расход 3000₸', intent: 'add_expense', done: true });
    await expect(confirmPendingVoiceAction(true)).resolves.toEqual({ message: 'Записал расход 3000₸', intent: 'add_expense' });
    expect(mockApi.post).toHaveBeenCalledWith('/voice/confirm-action', { confirm: true }, 'test-token-123');
  });
  it('409 → «устарело», не бросает', async () => {
    mockApi.post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await expect(confirmPendingVoiceAction(true)).resolves.toEqual({
      message: 'Нечего подтверждать — предложение устарело. Повтори запрос.',
      intent: null,
    });
  });
  it('сеть упала → бросает (UI покажет ошибку)', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await expect(confirmPendingVoiceAction(false)).rejects.toThrow('network');
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd apps/mobile && npx jest __tests__/services/voice-followup.test.ts`
Expected: FAIL «Cannot find module '@/services/voice-followup'».

- [ ] **Step 3: Реализация**

```ts
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * voice-one-brain: что мобилка делает ПОСЛЕ ответа сервера на голосовую
 * команду. Сервер (единый мозг) уже всё исполнил — кроме денег/необратимого,
 * где он вернул pendingAction и ждёт подтверждения. Клиент НИЧЕГО не исполняет.
 */
export interface PendingActionInfo {
  action: string;
  input: Record<string, unknown>;
}

export interface ProcessResponse {
  intent?: { action: string } | null;
  response?: string;
  pendingAction?: PendingActionInfo | null;
  confirmationText?: string | null;
}

export type VoiceFollowUp = { kind: 'confirm'; text: string } | { kind: 'done' };

const DEFAULT_CONFIRM_TEXT = 'Подтвердить действие?';
const STALE_TEXT = 'Нечего подтверждать — предложение устарело. Повтори запрос.';

/** Слот-вопрос FSM («На что потратил?») — ждёт ответа СЛОВАМИ, кнопки «Записать» тут нет смысла. */
export function isConfirmable(p: PendingActionInfo | null | undefined): p is PendingActionInfo {
  if (!p) return false;
  const input = p.input ?? {};
  return !input.__awaitingCategory && !input.__awaitingSource;
}

export function planVoiceFollowUp(res: ProcessResponse): VoiceFollowUp {
  if (isConfirmable(res.pendingAction)) {
    return { kind: 'confirm', text: res.confirmationText || DEFAULT_CONFIRM_TEXT };
  }
  return { kind: 'done' };
}

/** «Записать» / «Отмена» → сервер исполняет (или отменяет) отложенное действие. */
export async function confirmPendingVoiceAction(
  confirm: boolean,
): Promise<{ message: string; intent: string | null }> {
  const token = useAuthStore.getState().token;
  try {
    const res = await api.post<{ message: string; intent?: string }>(
      '/voice/confirm-action',
      { confirm },
      token || undefined,
    );
    return { message: res.message, intent: res.intent ?? null };
  } catch (err) {
    // ApiError несёт status; duck-typing — в тестах модуль api замокан целиком.
    if ((err as { status?: number }).status === 409) {
      return { message: STALE_TEXT, intent: null };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd apps/mobile && npx jest __tests__/services/voice-followup.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/services/voice-followup.ts apps/mobile/__tests__/services/voice-followup.test.ts
git commit -m "feat(mobile): voice-followup — подтверждение денежных голосовых команд через сервер"
```

### Task 4: Мобилка — `use-voice`: ответ сервера, Alert подтверждения, `transcribeOnly`

**Files:**
- Modify: `apps/mobile/hooks/use-voice.ts` (сигнатура `useVoice` ~233; `processCommand` ~458-505)
- Modify: `apps/mobile/app/(tabs)/chat.tsx:128`

- [ ] **Step 1: Модульный хелпер озвучки (над `export function useVoice`)**

```ts
async function speakText(text: string): Promise<void> {
  try {
    const voiceId = await getPreferredVoiceIdentifier();
    Speech.speak(text, { language: 'ru-RU', rate: 1.05, voice: voiceId });
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Сигнатура хука + режим транскрипции**

```ts
export interface UseVoiceOptions {
  /** Только распознать речь: НЕ звать /voice/process и не озвучивать.
   *  Для экранов, которые сами шлют текст в мозг (чат → /voice/chat),
   *  иначе команда исполнится дважды. */
  transcribeOnly?: boolean;
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const transcribeOnly = options.transcribeOnly === true;
```

- [ ] **Step 3: Подтверждение + новый `processCommand`**

Импорт вверху файла: `import { planVoiceFollowUp, confirmPendingVoiceAction, type ProcessResponse } from '@/services/voice-followup';` — и удалить локальный `interface ProcessResponse` (строки ~130-133).

Перед `processCommand`:

```ts
  // voice-one-brain: деньги/необратимое сервер не исполняет без «да».
  // Кнопки → /voice/confirm-action; сказать «да» в микрофон тоже работает.
  const askToConfirm = useCallback((text: string, transcript: string) => {
    const finish = async (confirm: boolean) => {
      try {
        const res = await confirmPendingVoiceAction(confirm);
        if (isMountedRef.current) {
          setLastResult({ intent: { action: res.intent ?? 'confirm_action' }, response: res.message, transcript });
        }
        void speakText(res.message);
      } catch {
        Alert.alert('Ошибка', 'Не получилось подтвердить. Попробуй ещё раз или скажи «да».');
      }
    };
    Alert.alert('Подтверди', text, [
      { text: 'Отмена', style: 'cancel', onPress: () => void finish(false) },
      { text: 'Записать', onPress: () => void finish(true) },
    ]);
  }, []);
```

Тело `processCommand` заменить на:

```ts
  const processCommand = useCallback(
    async (transcript: string) => {
      if (transcribeOnly) {
        if (isMountedRef.current) {
          setLastResult({ intent: { action: 'transcript' }, response: '', transcript });
          setState('idle');
        }
        return;
      }
      const token = useAuthStore.getState().token;
      try {
        // Единый мозг: сервер исполняет команду ДО ответа (или ждёт «да»),
        // поэтому озвучиваем только его ответ — он правдивый.
        const processData = await api.post<ProcessResponse>(
          '/voice/process',
          { text: transcript },
          token || undefined,
        );
        const result: VoiceResult = {
          intent: processData.intent ?? { action: 'unknown' },
          response:
            processData.response ||
            `Я услышал: «${transcript}». Но не понял команду.`,
          transcript,
        };
        if (isMountedRef.current) {
          setLastResult(result);
          setState('speaking');
          hapticSuccess();
        }
        void speakText(result.response);
        const follow = planVoiceFollowUp(processData);
        if (follow.kind === 'confirm') askToConfirm(follow.text, transcript);
        setTimeout(() => {
          if (isMountedRef.current && state !== 'recording') {
            setState((s) => (s === 'speaking' ? 'idle' : s));
          }
        }, 2500);
      } catch (err) {
        console.warn('Voice process failed, showing transcript only', err);
        if (isMountedRef.current) {
          setLastResult({
            intent: { action: 'unknown' },
            response: `Я услышал: «${transcript}». Не получилось выполнить — попробуй ещё раз.`,
            transcript,
          });
          setState('idle');
          hapticError();
        }
      }
    },
    [state, transcribeOnly, hapticSuccess, hapticError, askToConfirm],
  );
```

Второе использование `getPreferredVoiceIdentifier` (~665, не в processCommand) не трогать.

- [ ] **Step 4: Чат на режим транскрипции**

`apps/mobile/app/(tabs)/chat.tsx:128`:
```ts
  const { isRecording, isProcessing, lastResult, startRecording, stopRecording, amplitude } = useVoice({ transcribeOnly: true });
```

- [ ] **Step 5: Типы**

Run: `cd apps/mobile && npx tsc --noEmit -p .`
Expected: 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/hooks/use-voice.ts "apps/mobile/app/(tabs)/chat.tsx"
git commit -m "feat(mobile): use-voice озвучивает ответ мозга + подтверждение денег; чат — transcribeOnly (без двойного исполнения)"
```

### Task 5: Мобилка — экраны больше не исполняют голос сами

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (~418-482)
- Modify: `apps/mobile/app/(tabs)/tasks.tsx` (~606-678, `handleRefresh` ~909)
- Modify: `apps/mobile/app/(tabs)/habits.tsx` (~829-900, `handleRefresh` ~1195)

- [ ] **Step 1: В каждом из трёх файлов удалить** `useEffect` с комментарием «Auto-execute voice actions…» и весь `const handleVoiceAction = useCallback(...)`.

- [ ] **Step 2: В каждом файле ПОСЛЕ объявления `handleRefresh` добавить**

```ts
  // voice-one-brain: голосовую команду исполнил СЕРВЕР (единый мозг) —
  // экран только подтягивает свой срез данных. Никакого локального исполнения.
  useEffect(() => {
    if (lastResult) void handleRefresh();
  }, [lastResult]); // eslint-disable-line react-hooks/exhaustive-deps
```

(Именно после `handleRefresh`: в `tasks.tsx`/`habits.tsx` он объявлен ниже старого эффекта — иначе ReferenceError (TDZ) на рендере.)

- [ ] **Step 3: Убрать ставшие неиспользуемыми импорты/переменные** (например `useFinanceStore`, `formatDate`, `Alert`, `toggleComplete`, `toggleHabitLog` — только если tsc/eslint показывает их неиспользуемыми).

Run: `cd apps/mobile && npx tsc --noEmit -p . && npx eslint "app/(tabs)/index.tsx" "app/(tabs)/tasks.tsx" "app/(tabs)/habits.tsx"`
Expected: 0 ошибок tsc; eslint без новых no-unused-vars.

- [ ] **Step 4: Гард, что автоисполнение не вернулось** — добавить в `apps/mobile/__tests__/services/voice-followup.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

describe('экраны не исполняют голос сами (voice-one-brain)', () => {
  it.each(['index.tsx', 'tasks.tsx', 'habits.tsx'])('%s: нет handleVoiceAction', (f) => {
    const src = readFileSync(join(__dirname, '../../app/(tabs)', f), 'utf-8');
    expect(src).not.toMatch(/handleVoiceAction/);
    expect(src).not.toMatch(/Auto-execute voice actions/);
  });
});
```

Run: `cd apps/mobile && npx jest __tests__/services/voice-followup.test.ts` → PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/index.tsx" "apps/mobile/app/(tabs)/tasks.tsx" "apps/mobile/app/(tabs)/habits.tsx" apps/mobile/__tests__/services/voice-followup.test.ts
git commit -m "fix(mobile): дашборд/задачи/привычки больше не исполняют голос локально — только рефреш после мозга"
```

### Task 6: Мобилка — кнопки подтверждения в чате (TDD)

**Files:**
- Modify: `apps/mobile/stores/chat-store.ts`
- Test: `apps/mobile/__tests__/stores/chat-store.test.ts`
- Modify: `apps/mobile/app/(tabs)/chat.tsx` (`ChatBubble` ~35-82, `renderItem` ~165)

- [ ] **Step 1: Падающий тест стора**

```ts
import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';

const mockApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
});

describe('chat-store: подтверждение денежных действий', () => {
  it('sendMessage сохраняет pendingAction у ответа ассистента', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const [assistant] = useChatStore.getState().messages;
    expect(assistant.role).toBe('assistant');
    expect(assistant.pendingAction).toEqual({ action: 'add_expense', input: { amount: 3000 } });
  });

  it('confirmPendingAction: снимает pendingAction и добавляет ответ сервера', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const askId = useChatStore.getState().messages[0].id;

    mockApi.post.mockResolvedValueOnce({ message: 'Записал расход 3000₸', intent: 'add_expense', done: true });
    await useChatStore.getState().confirmPendingAction(askId, true);

    const msgs = useChatStore.getState().messages;
    expect(msgs[0].content).toBe('Записал расход 3000₸');
    expect(msgs.find((m) => m.id === askId)?.pendingAction).toBeNull();
    expect(mockApi.post).toHaveBeenLastCalledWith('/voice/confirm-action', { confirm: true }, 'test-token-123');
  });

  it('слот-вопрос («На что потратил?») — без кнопок (pendingAction не сохраняется)', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'На что потратил 3000₸? (или «отмена»)',
      pendingAction: { action: 'add_expense', input: { amount: 3000, __awaitingCategory: true } },
    });
    await useChatStore.getState().sendMessage('потратил 3000');
    expect(useChatStore.getState().messages[0].pendingAction).toBeNull();
  });

  it('confirmPendingAction при сбое сети: pendingAction остаётся, показана ошибка', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать?',
      pendingAction: { action: 'add_expense', input: { amount: 1 } },
    });
    await useChatStore.getState().sendMessage('потратил 1 на тест');
    const askId = useChatStore.getState().messages[0].id;
    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await useChatStore.getState().confirmPendingAction(askId, true);
    const msgs = useChatStore.getState().messages;
    expect(msgs.find((m) => m.id === askId)?.pendingAction).not.toBeNull();
    expect(msgs[0].content).toMatch(/Не получилось подтвердить/);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd apps/mobile && npx jest __tests__/stores/chat-store.test.ts`
Expected: FAIL — `pendingAction` undefined / `confirmPendingAction is not a function`.

- [ ] **Step 3: Реализация в `chat-store.ts`**

Импорт: `import { confirmPendingVoiceAction, isConfirmable, type PendingActionInfo } from '@/services/voice-followup';`

В `ChatMessage` добавить: `pendingAction?: PendingActionInfo | null;`
В интерфейс состояния: `confirmPendingAction: (messageId: string, confirm: boolean) => Promise<void>;`

В `sendMessage` — тип ответа `api.post<{ message: string; actions?: ChatAction[]; pendingAction?: PendingActionInfo | null }>` и в `assistantMessage` добавить `pendingAction: isConfirmable(data.pendingAction) ? data.pendingAction : null,` (слот-вопрос «На что потратил?» — без кнопок, юзер отвечает текстом).

Новый метод стора:

```ts
  confirmPendingAction: async (messageId: string, confirm: boolean) => {
    try {
      const res = await confirmPendingVoiceAction(confirm);
      const reply: ChatMessage = {
        id: uniqueId('assistant'),
        role: 'assistant',
        content: res.message,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        messages: [
          reply,
          ...state.messages.map((m) => (m.id === messageId ? { ...m, pendingAction: null } : m)),
        ],
      }));
    } catch {
      const errorMessage: ChatMessage = {
        id: uniqueId('error'),
        role: 'assistant',
        content: 'Не получилось подтвердить — попробуй ещё раз или напиши «да».',
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ messages: [errorMessage, ...state.messages] }));
    }
  },
```

- [ ] **Step 4: Run — PASS**

Run: `cd apps/mobile && npx jest __tests__/stores/chat-store.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Кнопки в `chat.tsx`**

`ChatBubbleProps` → добавить `onConfirm: (messageId: string, confirm: boolean) => void;`, сигнатура `ChatBubble({ message, onAction, onConfirm })`. После блока `message.actions` внутри пузыря:

```tsx
        {!isUser && message.pendingAction && (
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => onConfirm(message.id, true)}
              activeOpacity={0.7}
            >
              <Text style={styles.actionButtonText}>✅ Записать</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => onConfirm(message.id, false)}
              activeOpacity={0.7}
            >
              <Text style={styles.actionButtonText}>✖️ Отмена</Text>
            </TouchableOpacity>
          </View>
        )}
```

В `ChatScreen`: достать `confirmPendingAction` из `useChatStore()`; 
```ts
  const handleConfirm = useCallback((messageId: string, confirm: boolean) => {
    hapticLight();
    void confirmPendingAction(messageId, confirm);
  }, [confirmPendingAction]);
```
`renderItem` → `<ChatBubble message={item} onAction={handleAction} onConfirm={handleConfirm} />`, deps `[handleAction, handleConfirm]`.

- [ ] **Step 6: Типы + полный jest**

Run: `cd apps/mobile && npx tsc --noEmit -p . && npx jest`
Expected: 0 ошибок; все наборы зелёные.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/stores/chat-store.ts apps/mobile/__tests__/stores/chat-store.test.ts "apps/mobile/app/(tabs)/chat.tsx"
git commit -m "feat(mobile): кнопки «Записать / Отмена» для денежных действий в чате"
```

### Task 7: Финальная проверка

- [ ] **Step 1:** `cd packages/server && npx tsc --noEmit -p . && npx vitest run --project unit && npx vitest run --project integration` — всё зелёное, кроме известного `buildGoalHabitHealth`.
- [ ] **Step 2:** `cd apps/mobile && npx tsc --noEmit -p . && npx jest` — всё зелёное.
- [ ] **Step 3:** `grep -rn "voice-pipeline\|processVoiceCommand\|handleVoiceAction" packages/server/src apps/mobile/app apps/mobile/hooks` — пусто (кроме тестов-гардов).
- [ ] **Step 4:** Независимое ревью дифа (superpowers:code-reviewer). Деплой сервера — только по слову Berik.
