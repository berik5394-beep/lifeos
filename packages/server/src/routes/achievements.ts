import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

interface AchievementDef {
  type: 'costume' | 'badge' | 'secret_pet' | 'theme';
  name: string;
  description?: string;
  condition?: string;
}

const ACHIEVEMENTS: Record<string, AchievementDef> = {
  // Costumes
  costume_bandana: { type: 'costume', name: 'Бандана', condition: 'streak >= 3' },
  costume_collar: { type: 'costume', name: 'Ошейник с медалью', condition: 'streak >= 7' },
  costume_crown: { type: 'costume', name: 'Корона', condition: 'streak >= 14' },
  costume_cape: { type: 'costume', name: 'Плащ супергероя', condition: 'streak >= 30' },
  costume_wings: { type: 'costume', name: 'Золотые крылья', condition: 'streak >= 60' },
  costume_aura: { type: 'costume', name: 'Легендарная аура', condition: 'streak >= 100' },
  // Badges
  badge_early_bird: { type: 'badge', name: 'Ранняя пташка', description: 'Заходил до 7:00 утра 7 дней подряд' },
  badge_night_owl: { type: 'badge', name: 'Ночная сова', description: 'Заполнял дневник после 23:00 месяц' },
  badge_marathoner: { type: 'badge', name: 'Марафонец', description: '20 000 шагов за день' },
  badge_frugal: { type: 'badge', name: 'Бережливый', description: 'В бюджете 3 месяца подряд' },
  badge_bookworm: { type: 'badge', name: 'Книжный червь', description: 'Чтение 60 дней подряд' },
  badge_iron_will: { type: 'badge', name: 'Железная воля', description: 'Серия 100 дней' },
  badge_social: { type: 'badge', name: 'Социальный', description: 'Поделился 10 раз' },
  badge_comeback: { type: 'badge', name: 'Возвращенец', description: 'Воскресил питомца' },
  // Secret pets
  pet_dragon: { type: 'secret_pet', name: 'Дракончик', condition: 'level >= 20' },
  pet_phoenix: { type: 'secret_pet', name: 'Феникс', condition: '3 revives' },
  pet_unicorn: { type: 'secret_pet', name: 'Единорог', condition: 'legend stage' },
  // Themes
  theme_neon: { type: 'theme', name: 'Неоновая ночь', condition: 'level >= 10' },
  theme_golden: { type: 'theme', name: 'Золотой закат', condition: 'level >= 25' },
  theme_cosmos: { type: 'theme', name: 'Космос', condition: 'level >= 40' },
  theme_minimal: { type: 'theme', name: 'Минимализм', condition: 'streak >= 30' },
  theme_kazakhstan: { type: 'theme', name: 'Казахстан', condition: 'level >= 50' },
};

const COSTUME_MAP: Record<string, string> = {
  costume_bandana: 'bandana',
  costume_collar: 'medal_collar',
  costume_crown: 'crown',
  costume_cape: 'superhero_cape',
  costume_wings: 'golden_wings',
  costume_aura: 'legendary_aura',
};

const claimSchema = z.object({});

const activeThemeSchema = z.object({
  theme: z.string().min(1, 'Тема обязательна'),
});

function checkAutoUnlock(key: string, pet: { streak: number; level: number; stage: string }): boolean {
  switch (key) {
    // Costumes
    case 'costume_bandana': return pet.streak >= 3;
    case 'costume_collar': return pet.streak >= 7;
    case 'costume_crown': return pet.streak >= 14;
    case 'costume_cape': return pet.streak >= 30;
    case 'costume_wings': return pet.streak >= 60;
    case 'costume_aura': return pet.streak >= 100;
    // Secret pets
    case 'pet_dragon': return pet.level >= 20;
    case 'pet_unicorn': return pet.stage === 'legend';
    // Themes
    case 'theme_neon': return pet.level >= 10;
    case 'theme_golden': return pet.level >= 25;
    case 'theme_cosmos': return pet.level >= 40;
    case 'theme_minimal': return pet.streak >= 30;
    case 'theme_kazakhstan': return pet.level >= 50;
    // Badges — badge_iron_will can be auto-checked
    case 'badge_iron_will': return pet.streak >= 100;
    default: return false;
  }
}

/**
 * C.16: бейджи, которым нужны данные сверх pet (steps/бюджет/
 * привычка-чтение). Раньше checkAutoUnlock ловил только iron_will —
 * 7 бейджей были мертвы в UI. Здесь — те, что РЕАЛЬНО триггерятся
 * по имеющимся данным. early_bird/night_owl/social/comeback не
 * реализованы намеренно: нет источника (нет таймстампов открытия
 * приложения / времени записи в дневник / счётчика шар / счётчика
 * воскрешений) — это отдельные фичи трекинга, не «бейдж».
 */
async function checkDataBadges(userId: string): Promise<string[]> {
  const earned: string[] = [];

  // marathoner — 20 000 шагов за любой день (StepLog.steps).
  const bigDay = await prisma.stepLog.findFirst({
    where: { userId, steps: { gte: 20000 } },
    select: { id: true },
  });
  if (bigDay) earned.push('badge_marathoner');

  // frugal — уложился в бюджет 3 полных месяца подряд (по каждому
  // месяцу: сумма расходов <= сумма лимитов; лимиты должны быть заданы).
  const now = new Date();
  let frugalMonths = 0;
  for (let i = 1; i <= 3; i++) {
    const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const [spent, limit] = await Promise.all([
      prisma.expense.aggregate({
        where: { userId, date: { gte: mStart, lt: mEnd } },
        _sum: { amount: true },
      }),
      prisma.budgetLimit.aggregate({
        where: {
          userId,
          month: mStart.getMonth() + 1,
          year: mStart.getFullYear(),
        },
        _sum: { monthlyLimit: true },
      }),
    ]);
    const lim = limit._sum.monthlyLimit ?? 0;
    if (lim > 0 && (spent._sum.amount ?? 0) <= lim) frugalMonths++;
  }
  if (frugalMonths === 3) earned.push('badge_frugal');

  // bookworm — привычка про чтение, 60+ выполнений за ~70 дней.
  const readHabits = await prisma.habit.findMany({
    where: {
      userId,
      active: true,
      OR: [
        { name: { contains: 'чтени', mode: 'insensitive' } },
        { name: { contains: 'книг', mode: 'insensitive' } },
        { name: { contains: 'read', mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  if (readHabits.length > 0) {
    const since = new Date();
    since.setDate(since.getDate() - 70);
    const reads = await prisma.habitLog.count({
      where: {
        userId,
        completed: true,
        habitId: { in: readHabits.map((h) => h.id) },
        date: { gte: since },
      },
    });
    if (reads >= 60) earned.push('badge_bookworm');
  }

  return earned;
}

export async function achievementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- GET /achievements — List all achievements with unlock status ---

  app.get('/achievements', async (request) => {
    const userId = request.userId;

    const [userAchievements, pet] = await Promise.all([
      prisma.achievement.findMany({ where: { userId } }),
      prisma.pet.findUnique({ where: { userId } }),
    ]);

    const unlockedMap = new Map(
      userAchievements.map((a) => [a.key, a]),
    );

    const petData = {
      streak: pet?.streak ?? 0,
      level: pet?.level ?? 1,
      stage: pet?.stage ?? 'baby',
    };

    // Auto-unlock eligible achievements
    const toUnlock: string[] = [];
    for (const key of Object.keys(ACHIEVEMENTS)) {
      if (!unlockedMap.has(key) && checkAutoUnlock(key, petData)) {
        toUnlock.push(key);
      }
    }
    // C.16: data-driven бейджи (steps/бюджет/чтение) — раньше не
    // разблокировались вообще.
    for (const key of await checkDataBadges(userId)) {
      if (!unlockedMap.has(key) && !toUnlock.includes(key)) {
        toUnlock.push(key);
      }
    }

    if (toUnlock.length > 0) {
      const achievementDef = ACHIEVEMENTS;
      await prisma.achievement.createMany({
        data: toUnlock.map((key) => ({
          userId,
          type: achievementDef[key].type,
          key,
        })),
        skipDuplicates: true,
      });

      // Refresh the map
      const newAchievements = await prisma.achievement.findMany({
        where: { userId, key: { in: toUnlock } },
      });
      for (const a of newAchievements) {
        unlockedMap.set(a.key, a);
      }
    }

    const result = Object.entries(ACHIEVEMENTS).map(([key, def]) => {
      const record = unlockedMap.get(key);
      return {
        key,
        type: def.type,
        name: def.name,
        description: def.description ?? def.condition,
        unlocked: !!record,
        claimed: record?.claimed ?? false,
        unlockedAt: record?.unlockedAt ?? null,
      };
    });

    return { achievements: result };
  });

  // --- POST /achievements/claim/:id — Claim an unlocked achievement ---

  app.post('/achievements/claim/:id', async (request, reply) => {
    const userId = request.userId;
    const { id } = request.params as { id: string };

    const def = ACHIEVEMENTS[id];
    if (!def) {
      return reply.status(404).send({ message: 'Достижение не найдено' });
    }

    const achievement = await prisma.achievement.findUnique({
      where: { userId_key: { userId, key: id } },
    });

    if (!achievement) {
      return reply.status(400).send({ message: 'Достижение ещё не разблокировано' });
    }

    if (achievement.claimed) {
      return reply.status(400).send({ message: 'Достижение уже получено' });
    }

    await prisma.achievement.update({
      where: { userId_key: { userId, key: id } },
      data: { claimed: true },
    });

    let reward = def.name;

    // If costume — equip it
    if (def.type === 'costume') {
      const costumeId = COSTUME_MAP[id];
      if (costumeId) {
        await prisma.pet.update({
          where: { userId },
          data: { costume: costumeId },
        });
        reward = `Костюм "${def.name}" надет на питомца`;
      }
    }

    // If theme — return theme data
    if (def.type === 'theme') {
      reward = `Тема "${def.name}" разблокирована`;
    }

    // If secret_pet — the type is available
    if (def.type === 'secret_pet') {
      reward = `Секретный питомец "${def.name}" разблокирован`;
    }

    return { success: true, reward };
  });

  // --- GET /achievements/badges — Just badges ---

  app.get('/achievements/badges', async (request) => {
    const userId = request.userId;

    const userAchievements = await prisma.achievement.findMany({
      where: { userId, type: 'badge' },
    });

    const unlockedMap = new Map(
      userAchievements.map((a) => [a.key, a]),
    );

    const badges = Object.entries(ACHIEVEMENTS)
      .filter(([, def]) => def.type === 'badge')
      .map(([key, def]) => {
        const record = unlockedMap.get(key);
        return {
          key,
          name: def.name,
          description: def.description ?? '',
          unlocked: !!record,
          claimed: record?.claimed ?? false,
          unlockedAt: record?.unlockedAt ?? null,
        };
      });

    return { badges };
  });

  // --- GET /themes — Available themes ---

  app.get('/themes', async (request) => {
    const userId = request.userId;

    const [userAchievements, user] = await Promise.all([
      prisma.achievement.findMany({
        where: { userId, type: 'theme' },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { settings: true },
      }),
    ]);

    const unlockedKeys = new Set(userAchievements.map((a) => a.key));
    const settings = (user?.settings as Record<string, unknown>) ?? {};
    const activeTheme = (settings.activeTheme as string) ?? 'default';

    const themes = Object.entries(ACHIEVEMENTS)
      .filter(([, def]) => def.type === 'theme')
      .map(([key, def]) => ({
        key,
        name: def.name,
        condition: def.condition,
        unlocked: unlockedKeys.has(key),
        active: key === activeTheme,
      }));

    // Add default theme
    themes.unshift({
      key: 'default',
      name: 'Стандартная',
      condition: '',
      unlocked: true,
      active: activeTheme === 'default',
    });

    return { themes, activeTheme };
  });

  // --- PUT /themes/active — Set active theme ---

  app.put('/themes/active', {
    preHandler: validate(activeThemeSchema),
  }, async (request, reply) => {
    const userId = request.userId;
    const { theme } = request.body as z.infer<typeof activeThemeSchema>;

    // Default theme is always available
    if (theme !== 'default') {
      const def = ACHIEVEMENTS[theme];
      if (!def || def.type !== 'theme') {
        return reply.status(400).send({ message: 'Неизвестная тема' });
      }

      const achievement = await prisma.achievement.findUnique({
        where: { userId_key: { userId, key: theme } },
      });

      if (!achievement) {
        return reply.status(400).send({ message: 'Тема ещё не разблокирована' });
      }
    }

    // Update user settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const currentSettings = (user?.settings as Record<string, unknown>) ?? {};
    const updatedSettings = { ...currentSettings, activeTheme: theme };

    await prisma.user.update({
      where: { id: userId },
      data: { settings: updatedSettings },
    });

    return { success: true, activeTheme: theme };
  });
}
