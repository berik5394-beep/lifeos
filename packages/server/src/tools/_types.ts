import type { z } from 'zod';

/**
 * SSOT migration Step 2 — единый интерфейс инструмента.
 *
 * Каждый tool — самодостаточный объект: описывает СЕБЯ целиком в
 * одной точке. Из этого объекта автогенерируется всё остальное
 * (Anthropic-схемы, текст возможностей в промпте, список confirm).
 * Руками эти три вещи больше не пишутся — иначе вернутся «пять
 * источников правды».
 */

export type ToolCategory =
  | 'finance'
  | 'task'
  | 'habit'
  | 'calendar'
  | 'travel'
  | 'memory'
  | 'info'
  | 'system';

/** read = ничего не меняет; write = обратимая запись юзеру; external = внешний эффект. */
export type ToolSideEffects = 'read' | 'write' | 'external';

/**
 * Phase 7 — integration requirement (Relayna pattern «tool-filter by
 * integration availability»). Если у юзера соответствующая integration
 * не подключена/неактивна — tool не показывается агенту (`agentToolSchemasForUser`)
 * → агент не вызовет → не упадёт. Hollow-tools класс багов закрыт системно.
 *
 * undefined = always available (default — не требует никакой
 * пользовательской интеграции).
 */
export type IntegrationRequirement =
  | { kind: 'google_oauth' } // Gmail, Google Calendar — Integration provider='google_calendar' + refreshToken
  | { kind: 'telegram_user_chat' }; // user-level TG mirror — Integration provider='telegram'

export interface ToolContext {
  userId: string;
}

export interface Tool<TIn = unknown, TOut = unknown> {
  /** Машинное имя, ровно как видит его модель. Совпадает с ключом реестра. */
  name: string;
  /** Человеческое описание → и в промпт, и в input для модели. */
  description: string;
  category: ToolCategory;
  /** zod-схема входа → автоген Anthropic input_schema + рантайм-валидация. */
  schema: z.ZodType<TIn>;
  /**
   * Гейт подтверждения ЖИВЁТ НА ИНСТРУМЕНТЕ, не в глобальном массиве
   * (иначе «забыл синхронизировать NEEDS_CONFIRM»). boolean — всегда;
   * функция от input — условно (напр. расход > 100k).
   */
  // TODO (не сейчас): `!needsConfirm` сейчас служит и security-прокси
  // «можно ли автономному агент-циклу» (agentToolSchemas). Когда
  // появится tool, где confirm (UX) и agent-disabled (security)
  // должны быть НЕЗАВИСИМЫ — выделить отдельное поле
  // `availableToAgent: boolean`, развязав эти два вопроса.
  needsConfirm: boolean | ((input: TIn) => boolean);
  sideEffects: ToolSideEffects;
  handler: (input: TIn, ctx: ToolContext) => Promise<TOut>;
  /** Опц. примеры фраз — помогают модели выбрать нужный tool. */
  examples?: string[];
  /**
   * Phase 7 — required user integration. Если задано, и у юзера
   * integration не активна — tool скрыт от агента
   * (`agentToolSchemasForUser`). undefined = always available.
   */
  requires?: IntegrationRequirement;
  /**
   * Tool-reliability: алиасы имён аргументов от модели → канонические
   * поля схемы (напр. { due_date: 'date', description: 'notes' }).
   * Применяются в `runRegistryTool` ДО zod-валидации (см.
   * `_normalize-args.ts`). Чинит «барахлят инструменты»: LLM шлёт
   * естественные имена, строгая схема отвергает. undefined = нет алиасов.
   */
  aliases?: Record<string, string>;
}

/**
 * Хелпер: на МЕСТЕ ОБЪЯВЛЕНИЯ строго типизирует handler/needsConfirm
 * по zod-схеме (где и важна типобезопасность), а наружу отдаёт
 * единый `Tool` (input стирается до unknown). Это намеренно: в
 * реестре/диспетчере вход приходит от модели как unknown и
 * валидируется `schema.parse` в рантайме — `Tool<{...}>` нельзя
 * хранить однородно из-за контравариантности параметра handler.
 */
export function defineTool<S extends z.ZodTypeAny, TOut>(t: {
  name: string;
  description: string;
  category: ToolCategory;
  schema: S;
  needsConfirm: boolean | ((input: z.infer<S>) => boolean);
  sideEffects: ToolSideEffects;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<TOut>;
  examples?: string[];
  requires?: IntegrationRequirement;
  aliases?: Record<string, string>;
}): Tool {
  return t as unknown as Tool;
}
