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

type PetVisualState = 'happy' | 'content' | 'normal' | 'sad' | 'sick' | 'hungry' | 'sleepy';

interface HealthBreakdown {
  habits: number;
  tasks: number;
  budget: number;
  steps: number;
  journal: number;
  meals: number;
}

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

function determineCostume(streak: number, weeklyAllComplete: boolean): string | null {
  if (weeklyAllComplete) return 'superhero';
  if (streak >= 7) return 'crown';
  return null;
}

export async function petRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- GET /pet — Get pet state with calculated health ---

  app.get('/pet', async (request) => {
    const userId = request.userId;
    const today = getStartOfDay(new Date());

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
          streak: 0,
          lastFed: new Date(),
          lastPlayed: new Date(),
        },
      });
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
    const now = new Date();
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

    // Check weekly completion for costume
    const dayOfWeek = now.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7)); // Monday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weeklyTasks = await prisma.task.findMany({
      where: { userId, date: { gte: weekStart, lt: weekEnd } },
      select: { completed: true },
    });
    const weeklyAllComplete = weeklyTasks.length > 0 && weeklyTasks.every((t) => t.completed);

    const costume = determineCostume(pet.streak, weeklyAllComplete);

    // Update pet in DB
    const updatedPet = await prisma.pet.update({
      where: { userId },
      data: {
        health: Math.round(health * 10) / 10,
        happiness: Math.round(happiness * 10) / 10,
        costume,
      },
    });

    return {
      pet: updatedPet,
      state,
      healthBreakdown,
    };
  });

  // --- PUT /pet/feed — Manual feed ---

  app.put('/pet/feed', async (request, reply) => {
    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: {
        lastFed: new Date(),
        happiness: Math.min(100, pet.happiness + 5),
      },
    });

    return updatedPet;
  });

  // --- PUT /pet/play — Manual play ---

  app.put('/pet/play', async (request, reply) => {
    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return reply.status(404).send({ message: 'Питомец не найден' });
    }

    const updatedPet = await prisma.pet.update({
      where: { userId: request.userId },
      data: {
        lastPlayed: new Date(),
        happiness: Math.min(100, pet.happiness + 10),
      },
    });

    return updatedPet;
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

  // --- GET /pet/history — Health history (MVP: current state + streak) ---

  app.get('/pet/history', async (request) => {
    const { days } = request.query as { days?: string };
    const numDays = Math.min(30, Math.max(1, Number(days) || 7));

    const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
    if (!pet) {
      return { pet: null, history: [] };
    }

    // For MVP: return current pet state with streak info
    // Calculate daily completion rates for the range
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

    // Group by date
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
