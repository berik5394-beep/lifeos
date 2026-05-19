import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * Phase 6 C2.4 — чтение синтезированного «характера» (UserProfile).
 * READ-ONLY, needsConfirm:false (безопасно: ничего не меняет, не
 * деньги/внешнее → автоматически разрешён агент-циклу). Это КЭШ
 * над Memory (#4 SSOT) — если синтеза ещё не было, честно говорим
 * об этом, НЕ выдумываем профиль (bug #1 класс).
 */
export const getUserProfileTool = defineTool({
  name: 'get_user_profile',
  description:
    'Синтезированный портрет пользователя: ценности, что его ' +
    'задевает (triggers), поведенческие паттерны, как с ним лучше ' +
    'говорить, ключевые отношения. Обновляется раз/неделю. Вызывай, ' +
    'когда нужно понять человека глубже для тёплого/точного ответа.',
  category: 'info',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['что ты обо мне знаешь', 'какой я человек по-твоему'],
  handler: async (_input, ctx) => {
    const p = await prisma.userProfile.findUnique({
      where: { userId: ctx.userId },
      select: {
        values: true,
        triggers: true,
        patterns: true,
        styleNotes: true,
        relationships: true,
        lastSynthesizedAt: true,
      },
    });
    if (!p || p.lastSynthesizedAt === null) {
      return {
        synthesized: false,
        message:
          'Профиль ещё не синтезирован (нужно больше взаимодействий ' +
          'или ещё не наступил недельный цикл). Пока опираюсь на ' +
          'память и текущий контекст.',
      };
    }
    return {
      synthesized: true,
      values: p.values,
      triggers: p.triggers,
      patterns: p.patterns,
      styleNotes: p.styleNotes,
      relationships: p.relationships,
      lastSynthesizedAt: p.lastSynthesizedAt,
    };
  },
});
