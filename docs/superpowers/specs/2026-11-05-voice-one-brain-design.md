# Голосовая кнопка → единый мозг (voice-one-brain)

**Дата:** 2026-11-05 · **Статус:** одобрен Berik · **Источник:** `AUDIT-2026-06-11-brain-hands.md`, раздел CRITICAL

## Проблема

Кнопка микрофона на **дашборде, в задачах и в привычках** (`useVoice` → `POST /voice/process`) идёт мимо единого мозга:

```
use-voice.ts processCommand → /voice/process
  → ai/voice-pipeline.ts: parseIntent + ШАБЛОННЫЙ ответ («Задача создана…»)
  → мобилка: useEffect «Auto-execute voice actions» → handleVoiceAction
    исполняет интент ЛОКАЛЬНО через сторы (index.tsx, tasks.tsx, habits.tsx)
```

Последствия (все проверены по коду):
1. **Деньги без подтверждения.** `add_expense`/`add_income` на сервере `needsConfirm:true`, а клиент зовёт `createExpense` напрямую. Whisper ослышался «тридцать тысяч» → 30 000 ₸ молча в БД.
2. **Мусорные задачи.** `voice-pipeline.ts`: `unknown` + не-вопрос → `create_task` с полным транскриптом, клиент исполняет без вопроса.
3. **TTS врёт.** «Задача создана» озвучивается ДО исполнения на клиенте, которое может упасть.
4. **Наивный поиск.** `tasks.find(t => t.title.includes(...))` — закрывает первую попавшуюся; серверные `matchOpenTask`/`matchHabit` не используются.
5. **Невидимо для мозга.** Нет ToolCall-аудита, `captureActivity`, памяти.

Уже через мозг (не трогаем): голос в чате (`/voice/chat`), экран «Голосовой разговор» (`/voice/conversation/*`).
Обнаружено попутно: **в мобилке нет UI подтверждения вообще** — сервер отдаёт `pendingAction`, приложение его игнорирует; подтвердить можно только словом «да» следующим сообщением.

## Решение

### 1. Сервер — `packages/server/src/routes/voice.ts`

`POST /voice/process` целиком делегирует `handleMessage(userId, text, 'voice')` (safety-гейт первым, confirm-FSM, реестр инструментов с аудитом, честные матчеры, память, канал `voice` = короткие TTS-ответы). Ответ — прежний контракт мобилки плюс поля подтверждения:

```ts
{
  intent: { action: string },          // jarvis.intent
  response: string,                    // jarvis.reply (+ "\n\n🔗 " + bookingUrl, как /voice/chat)
  pendingAction: { action, input } | null,
  confirmationText: string | null,
}
```

- Отдельная crisis-ветка (`matchesCrisisPhrase` → handleMessage) больше не нужна: `handleMessage` сам проверяет кризис первым. Структурный гард `voice-safety.test.ts` переписывается: «/voice/process делегирует handleMessage(userId, text, 'voice')» + «нет processVoiceCommand/parseIntent в роуте».
- **Удаляются** `src/ai/voice-pipeline.ts` (шаблоны + фоллбэк «unknown → задача») и импорт `processVoiceCommand`. `parseIntent` остаётся (им пользуется оркестратор).
- Rate-limit/AI-бюджет роута не меняются.

### 2. Мобилка — логика в одном месте, `apps/mobile/hooks/use-voice.ts`

Новый чистый модуль `apps/mobile/services/voice-followup.ts`:

```ts
export type VoiceFollowUp =
  | { kind: 'confirm'; text: string }  // показать «Записать / Отмена»
  | { kind: 'refresh' };               // сервер мог записать — обновить данные
export function planVoiceFollowUp(res: ProcessResponse): VoiceFollowUp;
export async function refreshAfterVoice(): Promise<void>;   // задачи на сегодня, привычки, расходы/доходы месяца
export async function confirmPendingVoiceAction(confirm: boolean): Promise<string>; // POST /voice/confirm-action
```

`processCommand` после ответа:
- озвучивает `response` (он уже правдивый — сервер исполнил ДО ответа);
- `confirm` → `Alert.alert(confirmationText, …, [Отмена, Записать])`; кнопка → `confirmPendingVoiceAction` → озвучить ответ сервера → `refreshAfterVoice()`. Сказать «да» в микрофон тоже работает (серверный FSM);
- `refresh` → `refreshAfterVoice()` (best-effort, ошибки глушатся — данные подтянутся при следующем фокусе).

Экраны `app/(tabs)/index.tsx`, `tasks.tsx`, `habits.tsx`: **удаляются** `handleVoiceAction` и `useEffect` автоисполнения. Экраны больше ничего не исполняют.

### 3. Чат — `apps/mobile/stores/chat-store.ts` + `app/(tabs)/chat.tsx`

- `ChatMessage` получает `pendingAction?: { action: string; input: Record<string, unknown> } | null`; `sendMessage` сохраняет `data.pendingAction` из `/voice/chat`.
- Под таким сообщением ассистента — кнопки «Записать / Отмена» → `confirmPendingAction(messageId, confirm)` в сторе: `POST /voice/confirm-action`, снимает `pendingAction` с сообщения, добавляет ответ сервера сообщением ассистента, затем `refreshAfterVoice()`.

### 4. Ошибки

- `/voice/confirm-action` → 409 (предложение протухло) — показать текст сервера («Нечего подтверждать — предложение устарело. Повтори запрос.»).
- Сеть/500 при `/voice/process` — как сейчас: честное «не получилось», ничего не озвучивается как успех.
- Ошибка подтверждения по сети — Alert «Не получилось подтвердить, попробуй ещё раз»; pending на сервере остаётся (TTL), можно сказать «да».

## Тесты

**Сервер (integration, реальная БД, без моков):** `src/routes/voice-process.it.test.ts` через `buildTestApp([voiceRoutes, chatRoutes])` — детерминированные фразы (префильтр без LLM):
1. «Потратил 3000 на еду» → 200, `pendingAction.action === 'add_expense'`, `Expense` в БД = 0; затем `POST /voice/confirm-action {confirm:true}` → `Expense` = 1.
2. «Создай задачу купить хлеб завтра» → `Task` в БД на локальное завтра юзера (`civilDayRefs(tz).tomorrow`), `pendingAction === null`.
3. Кризисная фраза → `intent.action === 'safety_crisis'`, ничего не создано.
4. Отмена: «Потратил 500 на такси» → `confirm:false` → `Expense` = 0.

**Сервер (unit, структурный):** `voice-safety.test.ts` переписан под делегирование; гард «`processVoiceCommand`/`voice-pipeline` нигде не импортируются». В `src/ai/intent-tz-wiring.test.ts` (TZ-фикс 2026-11-05) два кейса про `voice-pipeline`/`processVoiceCommand` удаляются — путь больше не существует, TZ голоса покрыт тем, что `handleMessage` уже резолвит пояс (`intent-tz.it.test.ts`).

**Мобилка (jest):** `__tests__/services/voice-followup.test.ts` — `planVoiceFollowUp` (pending → confirm c confirmationText; без pending → refresh; pending без текста → дефолтный текст).

## Вне скоупа (отдельные задачи)

- Честная ошибка STT («говорите громче» на сбой Groq) — аудит M2.
- Жадный регекс «сделал/закрой X» → привычка — аудит M1.
- Неоднозначный `complete_task` (2+ совпадения) — аудит Р2.
- Мёртвый экран `SwipeHome` (зарегистрирован, никто не навигирует).
- `routes/quick-add.ts` — UTC-дата (тот же класс, что intent-TZ).

## Выкатка

Сервер: деплой по слову Berik (без флага — это устранение обхода money-safety; прецедент honesty-фиксов). Мобилка: со следующей сборкой APK. Совместимость: старый APK получает тот же `{intent, response}`; автоисполнение в старом APK сработает на `intent.action` — **поэтому сервер для старого клиента безопасен только если интент уже исполнен сервером**: для `create_task`/`complete_*` старый клиент создаст дубль. APK ещё не выпущен (юзеров мобилки нет) → риск нулевой; фиксируем здесь, чтобы не выпускать APK со старым кодом после деплоя сервера.
