import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const renameSchema = z.object({
  name: z.string().min(1, 'Имя обязательно').max(30, 'Имя слишком длинное'),
});

const changeTypeSchema = z.object({
  type: z.enum(['cat', 'dog', 'fox', 'owl', 'dragon'], {
    errorMap: () => ({ message: 'Допустимые типы: cat, dog, fox, owl, dragon' }),
  }),
});

const reviveSchema = z.object({
  method: z.enum(['perfect_day', 'double_steps', 'three_days'], {
    errorMap: () => ({ message: 'Допустимые методы: perfect_day, double_steps, three_days' }),
  }),
});

const costumeSchema = z.object({
  costume: z.string().min(1, 'Костюм обязателен'),
});

type PetVisualState = 'happy' | 'content' | 'normal' | 'sad' | 'sick' | 'hungry' | 'sleepy' | 'dead';

interface HealthBreakdown {
  habits: number;
  tasks: number;
  budget: number;
  steps: number;
  journal: number;
  meals: number;
}

const COSTUME_REQUIREMENTS: Record<string, number> = {
  bandana: 3,
  medal_collar: 7,
  crown: 14,
  superhero_cape: 30,
  golden_wings: 60,
  legendary_aura: 100,
};

function getStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function determineVisualState(health: number, lastFed: Date): PetVisualState {
  const now = new Date();
  const hoursSinceLastFed = (now.getTime() - lastFed.getTime()) / (1000 * 60 * 60);
  const currentHour = now.getHours();

  if (currentHour >= 0 && currentHour < 6) return 'sleepy';
  if (hoursSinceLastFed > 6) return 'hungry';

  if (health >= 80) return 'happy';
  if (health >= 60) return 'content';
  if (health >= 40) return 'normal';
  if (health >= 20) return 'sad';
  return 'sick';
}

function getStage(level: number): string {
  if (level <= 5) return 'baby';
  if (level <= 15) return 'teen';
  if (level <= 30) return 'adult';
  if (level <= 50) return 'master';
  return 'legend';
}

function getRoomLevel(level: number): number {
  if (level <= 5) return 1;
  if (level <= 15) return 2;
  if (level <= 30) return 3;
  if (level <= 50) return 4;
  return 5;
}

function addXP(pet: { xp: number; level: number; xpToNext: number }, amount: number): {
  level: number;
  xp: number;
  xpToNext: number;
  stage: string;
  roomLevel: number;
  leveledUp: boolean;
} {
  let xp = pet.xp + amount;
  let level = pet.level;
  let xpToNext = pet.xpToNext;
  let leveledUp = false;

  while (xp >= xpToNext) {
    xp -= xpToNext;
    level++;
    xpToNext = Math.floor(xpToNext * 1.2);
    leveledUp = true;
  }

  const stage = getStage(level);
  const roomLevel = getRoomLevel(level);
  return { level, xp, xpToNext, stage, roomLevel, leveledUp };
}

export async function petRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- GET /pet — Get pet state with calculated health ---

  app.get('/pet', async (request) => {
    const userId = request.userId;
    const today = getStartOfDay(new Date());
    const now = new Date();

    // Find or create pet
    let pet = await prisma.pet.findUnique({ where: { userId } });
    if (!pet) {
      pet = await prisma.pet.create({
        data: {
          userId,
          type: 'cat',
          name: 'LifePet',
          health: 80,
          happiness: 80,
          level: 1,
          xp: 0,
          xpToNext: 100,
          stage: 'baby',
          streak: 0,
          isAlive: true,
          lastFed: now,
          lastPlayed: now,
          lastActive: now,
          roomLevel: 1,
        },
      });
    }

    // Check death: if lastActive was >2 days ago AND health was 0
    const hoursSinceLastActive = (now.getTime() - pet.lastActive.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastActive > 48 && pet.health <= 0 && pet.isAlive) {
      pet = await prisma.pet.update({
        where: { userId },
        data: { isAlive: false, diedAt: now },
      });
    }

    // If dead, return with revive options
    if (!pet.isAlive) {
      return {
        pet,
        state: 'dead' as PetVisualState,
        healthBreakdown: {
          habits: 0, tasks: 0, budget: 0, steps: 0, journal: 0, meals: 0,
        },
        reviveOptions: [
          { method: 'perfect_day', description: '100% задач и привычек за сегодня' },
          { method: 'double_steps', description: '20 000 шагов за сегодня' },
          { method: 'three_days', description: '80%+ задач и привычек 3 дня подряд' },
        ],
      };
    }

    // --- Calculate health breakdown ---

    // 1. Habits today: (completed / total) * 30
    const [totalHabits, completedHabits] = await Promise.all([
      prisma.habit.count({ where: { userId, active: true } }),
      prisma.habitLog.count({
        where: { userId, date: today, completed: true },
      }),
    ]);
    const habitsScore = totalHabits > 0
      ? (completedHabits / totalHabits) * 30
      : 30;

    // 2. Tasks today: (completed / total) * 25
    const [totalTasks, completedTasks] = await Promise.all([
      prisma.task.count({ where: { userId, date: today } }),
      prisma.task.count({ where: { userId, date: today, completed: true } }),
    ]);
    const tasksScore = totalTasks > 0
      ? (completedTasks / totalTasks) * 25
      : 25;

    // 3. Budget: (1 - overSpentCategories / totalCategories) * 15
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 1);

    const budgetLimits = await prisma.budgetLimit.findMany({
      where: { userId, month: currentMonth, year: currentYear },
    });

    let budgetScore = 15;
    if (budgetLimits.length > 0) {
      const expensesByCategory = await prisma.expense.groupBy({
        by: ['category'],
        where: {
          userId,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      });

      const spentMap = new Map(
        expensesByCategory.map((e) => [e.category, e._sum.amount ?? 0]),
      );

      let overSpent = 0;
      for (const limit of budgetLimits) {
        const spent = spentMap.get(limit.category) ?? 0;
        if (spent > limit.monthlyLimit) {
          overSpent++;
        }
      }

      budgetScore = (1 - overSpent / budgetLimits.length) * 15;
    }

    // 4. Steps: if steps >= 10000 then 10, else (steps / 10000) * 10
    const stepLog = await prisma.stepLog.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    const steps = stepLog?.steps ?? 0;
    const stepsScore = steps >= 10000 ? 10 : (steps / 10000) * 10;

    // 5. Journal: if entry exists for today then 10, else 0
    const journalEntry = await prisma.journalEntry.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    const journalScore = journalEntry ? 10 : 0;

    // 6. Meals: based on lastFed
    const hoursSinceLastFed = (now.getTime() - pet.lastFed.getTime()) / (1000 * 60 * 60);
    const mealsScore = hoursSinceLastFed <= 6
      ? 10
      : Math.max(0, 10 - hoursSinceLastFed);

    const healthBreakdown: HealthBreakdown = {
      habits: Math.round(habitsScore * 10) / 10,
      tasks: Math.round(tasksScore * 10) / 10,
      budget: Math.round(budgetScore * 10) / 10,
      steps: Math.round(stepsScore * 10) / 10,
      journal: journalScore,
      meals: Math.round(mealsScore * 10) / 10,
    };

    const health = Math.min(100, Math.max(0,
      habitsScore + tasksScore + budgetScore + stepsScore + journalScore + mealsScore,
    ));

    // Calculate happiness: average of health and (streak * 5, capped at 100)
    const streakBonus = Math.min(100, pet.streak * 5);
    const happiness = Math.min(100, Math.max(0, (health + streakBonus) / 2));

    // Determine visual state
    const state = determineVisualState(health, pet.lastFed);

    // Calculate stage and roomLevel from level
    const stage = getStage(pet.level);
    const roomLevel = getRoomLevel(pet.level);

    // Update pet in DB
    const updatedPet = await prisma.pet.update({
      where: { userId },
      data: {
        health: Math.round(health * 10) / 10,
        happiness: Math.round(happiness * 10) / 10,
        stage,
        roomLevel,
        lastActive: now,
      },
    });

    return {
      pet: updatedPet,
      state,
      healthBreakdown,
    };
  });

  // --- POST /pet/revive — Revive dead pet ---

  app.post('/pet/revive', {
    preHandler: validate(reviveSchema),
  }, async (request, reply) => {
    const userId = request.userId;
    const { method } = request.body as z.infer<typeof reviveSchema>;
    const today = getStartOfDay(new Date());

    const pet = await prisma.pet.findUnique({ where: { userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    if (pet.isAlive) {
      return reply.status(400).send({ message: 'Питомец жив, воскрешение не требуется' });
    }

    // Verify revive condition
    if (method === 'perfect_day') {
      const [totalTasks, completedTasks, totalHabits, completedHabits] = await Promise.all([
        prisma.task.count({ where: { userId, date: today } }),
        prisma.task.count({ where: { userId, date: today, completed: true } }),
        prisma.habit.count({ where: { userId, active: true } }),
        prisma.habitLog.count({ where: { userId, date: today, completed: true } }),
      ]);

      const tasksOk = totalTasks > 0 && completedTasks === totalTasks;
      const habitsOk = totalHabits > 0 && completedHabits === totalHabits;

      if (!tasksOk || !habitsOk) {
        return reply.status(400).send({
          message: 'Условие не выполнено: нужно 100% задач и 100% привычек за сегодня',
        });
      }
    } else if (method === 'double_steps') {
      const stepLog = await prisma.stepLog.findUnique({
        where: { userId_date: { userId, date: today } },
      });

      if (!stepLog || stepLog.steps < 20000) {
        return reply.status(400).send({
          message: 'Условие не выполнено: нужно минимум 20 000 шагов за сегодня',
        });
      }
    } else if (method === 'three_days') {
      // Check last 3 days each had >=80% tasks+habits
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayStart = getStartOfDay(date);

        const [totalTasks, completedTasks, totalHabits, completedHabits] = await Promise.all([
          prisma.task.count({ where: { userId, date: dayStart } }),
          prisma.task.count({ where: { userId, date: dayStart, completed: true } }),
          prisma.habit.count({ where: { userId, active: true } }),
          prisma.habitLog.count({ where: { userId, date: dayStart, completed: true } }),
        ]);

        const totalItems = totalTasks + totalHabits;
        const completedItems = completedTasks + completedHabits;

        if (totalItems === 0 || (completedItems / totalItems) < 0.8) {
          return reply.status(400).send({
            message: 'Условие не выполнено: нужно 80%+ задач и привычек за последние 3 дня',
          });
        }
      }
    }

    // Revive pet
    const updatedPet = await prisma.pet.update({
      where: { userId },
      data: {
        isAlive: true,
        health: 50,
        happiness: 50,
        level: 1,
        xp: 0,
        xpToNext: 100,
        stage: 'baby',
        streak: 0,
        diedAt: null,
        lastActive: new Date(),
        roomLevel: 1,
      },
    });

    return { pet: updatedPet };
  });

  // --- PUT /pet/feed — Manual feed + XP ---

  app.put('/pet/feed', async (request, reply) => {
    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    if (!pet.isAlive) {
      return reply.status(400).send({ message: 'Питомец мёртв. Сначала воскресите его' });
    }

    const xpResult = addXP(pet, 5);

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: {
        lastFed: new Date(),
        happiness: Math.min(100, pet.happiness + 5),
        xp: xpResult.xp,
        level: xpResult.level,
        xpToNext: xpResult.xpToNext,
        stage: xpResult.stage,
        roomLevel: xpResult.roomLevel,
      },
    });

    return { pet: updatedPet, leveledUp: xpResult.leveledUp };
  });

  // --- PUT /pet/play — Manual play + XP ---

  app.put('/pet/play', async (request, reply) => {
    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    if (!pet.isAlive) {
      return reply.status(400).send({ message: 'Питомец мёртв. Сначала воскресите его' });
    }

    const xpResult = addXP(pet, 10);

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: {
        lastPlayed: new Date(),
        happiness: Math.min(100, pet.happiness + 10),
        xp: xpResult.xp,
        level: xpResult.level,
        xpToNext: xpResult.xpToNext,
        stage: xpResult.stage,
        roomLevel: xpResult.roomLevel,
      },
    });

    return { pet: updatedPet, leveledUp: xpResult.leveledUp };
  });

  // --- GET /pet/costumes — List costumes with unlock status ---

  app.get('/pet/costumes', async (request) => {
    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    const streak = pet?.streak ?? 0;

    const costumes = Object.entries(COSTUME_REQUIREMENTS).map(([costume, requiredStreak]) => ({
      costume,
      requiredStreak,
      unlocked: streak >= requiredStreak,
      equipped: pet?.costume === costume,
    }));

    return { costumes, currentStreak: streak };
  });

  // --- PUT /pet/costume — Equip costume ---

  app.put('/pet/costume', {
    preHandler: validate(costumeSchema),
  }, async (request, reply) => {
    const { costume } = request.body as z.infer<typeof costumeSchema>;
    const userId = request.userId;

    const pet = await prisma.pet.findUnique({ where: { userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    if (!pet.isAlive) {
      return reply.status(400).send({ message: 'Питомец мёртв. Сначала воскресите его' });
    }

    const requiredStreak = COSTUME_REQUIREMENTS[costume];
    if (requiredStreak === undefined) {
      return reply.status(400).send({ message: 'Неизвестный костюм' });
    }

    if (pet.streak < requiredStreak) {
      return reply.status(400).send({
        message: `Костюм недоступен. Нужна серия ${requiredStreak} дней (текущая: ${pet.streak})`,
      });
    }

    const updatedPet = await prisma.pet.update({
      where: { userId },
      data: { costume },
    });

    return { pet: updatedPet };
  });

  // --- PUT /pet/name — Rename pet ---

  app.put('/pet/name', {
    preHandler: validate(renameSchema),
  }, async (request, reply) => {
    const { name } = request.body as z.infer<typeof renameSchema>;

    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: { name },
    });

    return updatedPet;
  });

  // --- PUT /pet/type — Change pet type ---

  app.put('/pet/type', {
    preHandler: validate(changeTypeSchema),
  }, async (request, reply) => {
    const { type } = request.body as z.infer<typeof changeTypeSchema>;

    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: { type },
    });

    return updatedPet;
  });

  // --- GET /pet/history — Health history ---

  app.get('/pet/history', async (request) => {
    const { days } = request.query as { days?: string };
    const numDays = Math.min(30, Math.max(1, Number(days) || 7));

    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return { pet: null, history: [] };
    }

    const today = getStartOfDay(new Date());
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - numDays + 1);

    const [habitLogs, tasks] = await Promise.all([
      prisma.habitLog.findMany({
        where: {
          userId: request.userId,
          date: { gte: startDate, lte: today },
          completed: true,
        },
        select: { date: true },
      }),
      prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: startDate, lte: today },
        },
        select: { date: true, completed: true },
      }),
    ]);

    const history: Array<{
      date: string;
      habitsCompleted: number;
      tasksCompleted: number;
      tasksTotal: number;
    }> = [];

    for (let i = 0; i < numDays; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const dayHabits = habitLogs.filter(
        (log) => log.date.toISOString().split('T')[0] === dateStr,
      ).length;

      const dayTasks = tasks.filter(
        (t) => t.date.toISOString().split('T')[0] === dateStr,
      );
      const dayTasksCompleted = dayTasks.filter((t) => t.completed).length;

      history.push({
        date: dateStr,
        habitsCompleted: dayHabits,
        tasksCompleted: dayTasksCompleted,
        tasksTotal: dayTasks.length,
      });
    }

    return {
      pet,
      history,
    };
  });
}
