import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const checkFeatureSchema = z.object({
  feature: z.string().min(1, 'Название функции обязательно'),
});

// Feature access matrix by tier
const TIER_FEATURES: Record<string, string[]> = {
  free: [
    'tasks_basic',
    'habits_basic',
    'finance_basic',
    'journal',
    'pet_basic',
    'tags_basic',
  ],
  pro: [
    'tasks_basic',
    'tasks_subtasks',
    'tasks_kanban',
    'tasks_dependencies',
    'tasks_quick_add',
    'tasks_prioritization',
    'habits_basic',
    'habits_advanced',
    'finance_basic',
    'finance_budgets',
    'finance_ai_advice',
    'journal',
    'pet_basic',
    'pet_costumes',
    'tags_basic',
    'tags_unlimited',
    'shared_spaces',
    'voice_assistant',
    'ai_chat',
    'import_files',
    'export_csv',
    'integrations',
    'themes_all',
  ],
  premium: [
    'tasks_basic',
    'tasks_subtasks',
    'tasks_kanban',
    'tasks_dependencies',
    'tasks_quick_add',
    'tasks_prioritization',
    'habits_basic',
    'habits_advanced',
    'finance_basic',
    'finance_budgets',
    'finance_ai_advice',
    'journal',
    'pet_basic',
    'pet_costumes',
    'pet_arena',
    'tags_basic',
    'tags_unlimited',
    'shared_spaces',
    'shared_spaces_unlimited',
    'voice_assistant',
    'voice_assistant_unlimited',
    'ai_chat',
    'ai_chat_unlimited',
    'import_files',
    'export_csv',
    'export_pdf',
    'export_stories',
    'integrations',
    'integrations_all',
    'themes_all',
    'telegram_bot',
    'travel_planner',
    'document_vault',
  ],
};

const TIER_LIMITS: Record<string, Record<string, number>> = {
  free: {
    max_tags: 5,
    max_shared_spaces: 0,
    max_tasks_per_day: 20,
    max_ai_requests_per_day: 5,
  },
  pro: {
    max_tags: 50,
    max_shared_spaces: 3,
    max_tasks_per_day: 100,
    max_ai_requests_per_day: 50,
  },
  premium: {
    max_tags: -1, // unlimited
    max_shared_spaces: -1,
    max_tasks_per_day: -1,
    max_ai_requests_per_day: -1,
  },
};

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /subscription — return current tier + features list
  app.get('/subscription', async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        subscriptionTier: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!user) {
      return { tier: 'free', features: TIER_FEATURES['free'], limits: TIER_LIMITS['free'] };
    }

    // Check if subscription expired
    let effectiveTier = user.subscriptionTier;
    if (
      user.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt) < new Date()
    ) {
      effectiveTier = 'free';
      // Update user to free tier
      await prisma.user.update({
        where: { id: request.userId },
        data: { subscriptionTier: 'free', subscriptionExpiresAt: null },
      });
    }

    return {
      tier: effectiveTier,
      expiresAt: user.subscriptionExpiresAt,
      features: TIER_FEATURES[effectiveTier] ?? TIER_FEATURES['free'],
      limits: TIER_LIMITS[effectiveTier] ?? TIER_LIMITS['free'],
    };
  });

  // POST /subscription/check-feature — { feature } → { allowed, reason? }
  app.post('/subscription/check-feature', {
    preHandler: validate(checkFeatureSchema),
  }, async (request, reply) => {
    const { feature } = request.body as z.infer<typeof checkFeatureSchema>;

    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: {
        subscriptionTier: true,
        subscriptionExpiresAt: true,
      },
    });

    let effectiveTier = user?.subscriptionTier ?? 'free';
    if (
      user?.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt) < new Date()
    ) {
      effectiveTier = 'free';
    }

    const allowedFeatures = TIER_FEATURES[effectiveTier] ?? TIER_FEATURES['free'];
    const allowed = allowedFeatures.includes(feature);

    if (allowed) {
      return reply.send({ allowed: true });
    }

    // Find which tier provides this feature
    let requiredTier = 'premium';
    for (const [tier, features] of Object.entries(TIER_FEATURES)) {
      if (features.includes(feature)) {
        requiredTier = tier;
        break;
      }
    }

    return reply.send({
      allowed: false,
      reason: `Функция "${feature}" доступна начиная с тарифа "${requiredTier}"`,
      requiredTier,
    });
  });
}
