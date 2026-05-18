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
   *
   * Сейчас `!needsConfirm` используется и как security-прокси
   * «можно ли автономному агент-циклу» (см. agentToolSchemas).
   * TODO (не сейчас, фокус важнее): когда появится первый tool,
   * для которого confirm (UX) и agent-disabled (security) должны
   * быть НЕЗАВИСИМЫ — выделить отдельное поле
   * `availableToAgent: boolean`, развязав эти два вопроса.
   */
  needsConfirm: boolean | ((input: TIn) => boolean);
  sideEffects: ToolSideEffects;
  handler: (input: TIn, ctx: ToolContext) => Promise<TOut>;
  /** Опц. примеры фраз — помогают модели выбрать нужный tool. */
  examples?: string[];
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
}): Tool {
  return t as unknown as Tool;
}
