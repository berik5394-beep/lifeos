# Робот-эпик, Часть 1: удалить старый игровой слой (питомец, Арена, ачивки)

**Дата:** 2026-11-05 · **Решение Berik:** «Удалить полностью» (явное исключение из правила «ничего не удалять» — только для этого слоя). Слой заменяет робот с комнатой (Части 2–4). Карта удаления — результат инвентаризации (пути/строки на `main` 2ff7520).

## Решения
- **SwipeHome** удаляем целиком: на него нет переходов, страница 0 — персонаж/мана/арена, остальное дублирует табы.
- **Серия в брифинге/push/контексте ИИ** бралась из `Pet.streak` → заменяем на серию привычек `calculateStreak(userId, tz)` (`services/streak-service.ts` остаётся). Поле `streak` в ответах сохраняем (мобильный тип `BriefingResponse` его ждёт).
- **Темы:** удаляем только серверные `/themes`, `/themes/active` и `fetchThemes/setActiveTheme` в `achievement-store`. Локальные темы мобилки (`constants/themes.ts`, `theme-store`) не трогаем. PRO-строку «1 тема / 6 тем» — отдельно, не сейчас.
- `/vision/verify-exercise` — удалить (обслуживал только челленджи, клиент не вызывает).
- `generateInactivityPing` («питомец скучает») — мёртвый код, удалить.
- Hermes `BLOCKLIST.categories: 'pet'` — оставить (защитный запрет, безвреден).
- **БД:** модели `Pet, PetItem, Achievement, ArenaProfile, Battle, Challenge` + связи в `User` убрать из схемы; миграция `20261105010000_drop_game_layer` с `DROP TABLE IF EXISTS` (сначала зависимые: Battle, Challenge → ArenaProfile; PetItem → Pet; затем Achievement). **Обязательно в одном деплое с кодом**: связи с User без каскада → без DROP удаление аккаунта упадёт на строках-сиротах. Деплой — только после повторного «да» Berik.

## Задачи
1. **Мобилка — файлы:** удалить `app/{pet,arena,battle-screen,character-select,achievements,swipe-home}.tsx`, `screens/{…}.ts` (те же 6), `components/characters/*`, `components/shared/pet-avatar.tsx`, `stores/{pet-store,achievement-store}.ts`, `constants/characters/index.ts`, `__tests__/stores/pet-store.test.ts`.
2. **Мобилка — правки:** `navigation/index.tsx` и `types.ts` (регистрации + мёртвые `BattleScreen`/`ExerciseTracker`/`SwipeHome`); дашборд (`PetAvatar`, `usePetStore`, кнопка «Арена», навигация на Pet, стиль); онбординг (шаг питомца и всё, что к нему относится); `subscription.tsx` (строки «Питомец», «Все костюмы»); `subscription-store.ts` (`all_costumes`); `ui-store.ts` (`pet_widget`); `components/shared/index.ts`; `types/index.ts` (`PetStage`, `Achievement`); `legal.tsx` (строка про питомца/достижения).
3. **Мобилка — зависимости:** удалить `@react-three/drei`, `@react-three/fiber`, `expo-gl`, `expo-three`, `three`, `@types/three`; обновить lock.
4. **Сервер — файлы:** `routes/{pet,achievements,arena,challenge}.ts`, `services/{items-catalog,pet-streak-service}.ts`, `services/pet-streak-service.test.ts`; регистрации в `src/index.ts`.
5. **Сервер — правки:** `routes/habits.ts`, `routes/tasks.ts` (мана/XP при выполнении, `addXP`); `proactive-scheduler.ts` (pet streak sweep); `briefing.ts`, `notifications.ts`, `proactive-notifications.ts`, `life-truth-analyzer.ts` (pet → `calculateStreak`); `proactive-insights.ts` (категория/блок «питомец»); `vision.ts` (verify-exercise); `app-info.ts` (`arenaEnabled`); `auth.ts` (delete-account шаги питомца/арены).
6. **Схема + миграция** (см. «Решения»).
7. **Тесты:** обновить `habit-day-guard.test.ts` (убрать `routes/pet.ts`), `proactive-insights.test.ts` (поле/блок питомца); новый гард `game-layer-removed.test.ts`: ни в `src/` сервера, ни в `apps/mobile` (кроме тестов-гардов) нет `prisma.pet`, `addXP`, `usePetStore`, `/arena`, `/achievements`; удаление аккаунта (`auth.it.test.ts`) проходит; серверные tsc + unit + integration; мобильные tsc + jest.
