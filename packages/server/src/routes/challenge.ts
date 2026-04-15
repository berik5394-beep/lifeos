import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

// Anti-cheat: reject any "completed" exercise that took less than this
const MIN_EXERCISE_SECONDS = 10;
// Cap at 1 hour — anything longer means the user walked away
const MAX_EXERCISE_SECONDS = 60 * 60;

// ===== EXERCISE DATABASE =====
const EXERCISES = [
  { key: 'squats', name: 'Приседания', baseReps: 50, unit: 'раз', emoji: '🦵' },
  { key: 'pushups', name: 'Отжимания', baseReps: 30, unit: 'раз', emoji: '💪' },
  { key: 'plank', name: 'Планка', baseReps: 60, unit: 'секунд', emoji: '🧘' },
  { key: 'burpees', name: 'Бёрпи', baseReps: 20, unit: 'раз', emoji: '🔥' },
  { key: 'jumps', name: 'Прыжки', baseReps: 40, unit: 'раз', emoji: '🦘' },
  { key: 'lunges', name: 'Выпады', baseReps: 30, unit: 'раз', emoji: '🏃' },
  { key: 'situps', name: 'Пресс', baseReps: 40, unit: 'раз', emoji: '🤸' },
  { key: 'highknees', name: 'Высокие колени', baseReps: 50, unit: 'раз', emoji: '🏃‍♂️' },
];

const RARITY_POWER: Record<string, number> = {
  common: 5, rare: 15, epic: 30, legendary: 50,
};

const MANA_COST = 20; // cost per challenge

// ===== EQUIPMENT DIFFICULTY SCALING =====
// Better gear = easier challenge (lower target), worse gear = harder
async function getEquipmentScore(userId: string): Promise<number> {
  const pet = await prisma.pet.findUnique({
    where: { userId },
    include: { items: true },
  });
  if (!pet) return 0;

  let score = 0;
  const equipped = [
    pet.equippedHelmet, pet.equippedArmor, pet.equippedWeapon,
    pet.equippedShield, pet.equippedBoots, pet.equippedAura,
  ].filter(Boolean) as string[];

  for (const key of equipped) {
    const item = pet.items.find(i => i.itemKey === key);
    if (item) score += RARITY_POWER[item.rarity] || 0;
  }
  return score; // 0-300+ range
}

// Scale target: high equipment = easier (0.5x-1.0x), low equipment = harder (1.0x-1.5x)
function scaleTarget(baseReps: number, equipScore: number): number {
  // equipScore 0 → multiplier 1.4 (harder)
  // equipScore 100 → multiplier 1.0 (normal)
  // equipScore 200+ → multiplier 0.6 (easier)
  const multiplier = Math.max(0.5, Math.min(1.5, 1.4 - (equipScore / 150)));
  return Math.round(baseReps * multiplier);
}

// Generate a random challenge
function generateChallenge() {
  const exercise = EXERCISES[Math.floor(Math.random() * EXERCISES.length)];
  return exercise;
}


// ===== ROUTES =====
export async function challengeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- GET /challenge/mana — Get current mana ---
  app.get('/challenge/mana', async (request) => {
    const userId = request.userId;
    const pet = await prisma.pet.findUnique({ where: { userId } });
    if (!pet) return { mana: 0, maxMana: 100 };
    return { mana: pet.mana, maxMana: pet.maxMana };
  });

  // --- POST /challenge/create — Create a physical challenge (costs mana) ---
  const createChallengeSchema = z.object({
    opponentUserId: z.string().min(1).max(64),
  });

  app.post('/challenge/create', {
    preHandler: validate(createChallengeSchema),
  }, async (request, reply) => {
    const userId = request.userId;
    const { opponentUserId } = request.body as z.infer<typeof createChallengeSchema>;

    // SECURITY: block self-challenge (trophy farming loop)
    if (opponentUserId === userId) {
      return reply.status(400).send({ error: 'Нельзя бросить вызов самому себе' });
    }

    // Check mana
    const pet = await prisma.pet.findUnique({ where: { userId } });
    if (!pet) return reply.status(404).send({ error: 'Питомец не найден' });

    if (pet.mana < MANA_COST) {
      return reply.status(400).send({
        error: `Недостаточно маны! Нужно ${MANA_COST}, у тебя ${pet.mana}`,
        manaCost: MANA_COST,
        currentMana: pet.mana,
      });
    }

    // Check opponent exists
    const opponentPet = await prisma.pet.findUnique({ where: { userId: opponentUserId } });
    if (!opponentPet) return reply.status(404).send({ error: 'Противник не найден' });

    // Generate challenge
    const exercise = generateChallenge();
    const attackerEquip = await getEquipmentScore(userId);
    const defenderEquip = await getEquipmentScore(opponentUserId);

    const attackerTarget = scaleTarget(exercise.baseReps, attackerEquip);
    const defenderTarget = scaleTarget(exercise.baseReps, defenderEquip);

    // Spend mana
    await prisma.pet.update({
      where: { userId },
      data: { mana: { decrement: MANA_COST } },
    });

    // Create challenge with 30min expiry
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const challenge = await prisma.challenge.create({
      data: {
        attackerId: userId,
        defenderId: opponentUserId,
        exercise: exercise.key,
        exerciseName: exercise.name,
        targetReps: exercise.baseReps,
        attackerTarget,
        defenderTarget,
        manaCost: MANA_COST,
        status: 'active',
        xpReward: 30,
        trophyReward: 20,
        expiresAt,
      },
    });

    return {
      challenge: {
        id: challenge.id,
        exercise: exercise.key,
        exerciseName: exercise.name,
        emoji: exercise.emoji,
        unit: exercise.unit,
        attackerTarget,
        defenderTarget,
        manaCost: MANA_COST,
        expiresAt,
      },
      equipmentAdvantage: {
        attacker: attackerEquip,
        defender: defenderEquip,
        attackerMultiplier: Math.max(0.5, Math.min(1.5, 1.4 - (attackerEquip / 150))),
        defenderMultiplier: Math.max(0.5, Math.min(1.5, 1.4 - (defenderEquip / 150))),
      },
      manaRemaining: pet.mana - MANA_COST,
    };
  });

  // --- POST /challenge/start — Record server-side start time (anti-cheat) ---
  // Must be called before /challenge/complete. Records the exact server
  // timestamp so that `timeSeconds` in /complete is derived from the server,
  // not trusted from the client.
  const startChallengeSchema = z.object({
    challengeId: z.string().min(1).max(64),
  });

  app.post('/challenge/start', {
    preHandler: validate(startChallengeSchema),
  }, async (request, reply) => {
    const userId = request.userId;
    const { challengeId } = request.body as z.infer<typeof startChallengeSchema>;

    const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return reply.status(404).send({ error: 'Челлендж не найден' });
    if (challenge.status !== 'active') {
      return reply.status(400).send({ error: 'Челлендж уже завершён или истёк' });
    }
    if (new Date() > challenge.expiresAt) {
      await prisma.challenge.update({
        where: { id: challengeId },
        data: { status: 'expired' },
      });
      return reply.status(400).send({ error: 'Челлендж истёк!' });
    }

    const isAttacker = challenge.attackerId === userId;
    const isDefender = challenge.defenderId === userId;
    if (!isAttacker && !isDefender) {
      return reply.status(403).send({ error: 'Ты не участник этого челленджа' });
    }

    // Idempotent: if already started, return the existing timestamp
    const existingStart = isAttacker ? challenge.attackerStartedAt : challenge.defenderStartedAt;
    if (existingStart) {
      return { startedAt: existingStart, alreadyStarted: true };
    }

    const startedAt = new Date();
    await prisma.challenge.update({
      where: { id: challengeId },
      data: isAttacker ? { attackerStartedAt: startedAt } : { defenderStartedAt: startedAt },
    });

    return { startedAt, alreadyStarted: false };
  });

  // --- POST /challenge/complete — Mark challenge as completed by user ---
  // SECURITY: timeSeconds is computed server-side from /start timestamp.
  // Client cannot claim "0 seconds" to auto-win.
  const completeChallengeSchema = z.object({
    challengeId: z.string().min(1).max(64),
    verified: z.boolean().optional(), // optional AI camera verification flag
  });

  app.post('/challenge/complete', {
    preHandler: validate(completeChallengeSchema),
  }, async (request, reply) => {
    const userId = request.userId;
    const { challengeId, verified } = request.body as z.infer<typeof completeChallengeSchema>;

    const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return reply.status(404).send({ error: 'Челлендж не найден' });
    if (challenge.status !== 'active') {
      return reply.status(400).send({ error: 'Челлендж уже завершён или истёк' });
    }
    if (new Date() > challenge.expiresAt) {
      await prisma.challenge.update({ where: { id: challengeId }, data: { status: 'expired' } });
      return reply.status(400).send({ error: 'Челлендж истёк!' });
    }

    const isAttacker = challenge.attackerId === userId;
    const isDefender = challenge.defenderId === userId;
    if (!isAttacker && !isDefender) {
      return reply.status(403).send({ error: 'Ты не участник этого челленджа' });
    }

    // Must have called /start first — prevents time=0 exploits
    const startedAt = isAttacker ? challenge.attackerStartedAt : challenge.defenderStartedAt;
    if (!startedAt) {
      return reply.status(400).send({
        error: 'Сначала нажми "Начать" — без этого нельзя завершить челлендж.',
      });
    }

    // Server-computed elapsed time
    const elapsedMs = Date.now() - startedAt.getTime();
    let timeSeconds = Math.round(elapsedMs / 1000);

    // Anti-cheat: reject sub-10s "completions" (human minimum for most exercises)
    if (timeSeconds < MIN_EXERCISE_SECONDS) {
      return reply.status(400).send({
        error: `Слишком быстро! Минимум ${MIN_EXERCISE_SECONDS} секунд. Попробуй ещё раз честно.`,
      });
    }

    // Cap abnormally long sessions
    if (timeSeconds > MAX_EXERCISE_SECONDS) timeSeconds = MAX_EXERCISE_SECONDS;

    // Update completion
    const updateData: Record<string, unknown> = {};
    if (isAttacker) {
      updateData.attackerDone = true;
      updateData.attackerTime = timeSeconds;
      if (verified) updateData.attackerVerified = true;
    } else {
      updateData.defenderDone = true;
      updateData.defenderTime = timeSeconds;
      if (verified) updateData.defenderVerified = true;
    }

    let updatedChallenge = await prisma.challenge.update({
      where: { id: challengeId },
      data: updateData,
    });

    // Check if both done — resolve winner
    let result: any = { completed: true, waitingForOpponent: true };

    if (updatedChallenge.attackerDone && updatedChallenge.defenderDone) {
      // Both done! Winner = faster time
      let winnerId: string | null = null;
      const aTime = updatedChallenge.attackerTime || 999999;
      const dTime = updatedChallenge.defenderTime || 999999;

      if (aTime < dTime) winnerId = challenge.attackerId;
      else if (dTime < aTime) winnerId = challenge.defenderId;
      // else: tie, no winner

      updatedChallenge = await prisma.challenge.update({
        where: { id: challengeId },
        data: { status: 'completed', winnerId },
      });

      // Award trophies and XP to winner
      if (winnerId) {
        const loserId = winnerId === challenge.attackerId ? challenge.defenderId : challenge.attackerId;

        // Winner gets trophies + XP
        await prisma.arenaProfile.updateMany({
          where: { userId: winnerId },
          data: { trophies: { increment: challenge.trophyReward }, wins: { increment: 1 } },
        });
        await prisma.pet.update({
          where: { userId: winnerId },
          data: { xp: { increment: challenge.xpReward }, mana: { increment: 5 } },
        });

        // Loser loses some trophies
        const loserProfile = await prisma.arenaProfile.findUnique({ where: { userId: loserId } });
        if (loserProfile) {
          await prisma.arenaProfile.update({
            where: { userId: loserId },
            data: {
              trophies: Math.max(0, loserProfile.trophies - Math.round(challenge.trophyReward * 0.5)),
              losses: { increment: 1 },
            },
          });
        }
      }

      result = {
        completed: true,
        waitingForOpponent: false,
        winnerId,
        attackerTime: updatedChallenge.attackerTime,
        defenderTime: updatedChallenge.defenderTime,
        isDraw: !winnerId,
        trophyReward: challenge.trophyReward,
        xpReward: challenge.xpReward,
      };
    }

    return {
      ...result,
      challenge: {
        id: updatedChallenge.id,
        exercise: updatedChallenge.exercise,
        exerciseName: updatedChallenge.exerciseName,
        status: updatedChallenge.status,
        attackerDone: updatedChallenge.attackerDone,
        defenderDone: updatedChallenge.defenderDone,
      },
    };
  });

  // Helper: batch-load user names for a set of challenges
  async function loadNames(challenges: { attackerId: string; defenderId: string }[]) {
    const ids = new Set<string>();
    for (const c of challenges) {
      ids.add(c.attackerId);
      ids.add(c.defenderId);
    }
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  // --- GET /challenge/active — Get active challenges for user ---
  app.get('/challenge/active', async (request) => {
    const userId = request.userId;

    // Expire old ones
    await prisma.challenge.updateMany({
      where: { status: 'active', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const challenges = await prisma.challenge.findMany({
      where: {
        status: 'active',
        OR: [{ attackerId: userId }, { defenderId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const names = await loadNames(challenges);

    const enriched = challenges.map((c) => {
      const ex = EXERCISES.find((e) => e.key === c.exercise);
      const isAttacker = c.attackerId === userId;
      return {
        id: c.id,
        exercise: c.exercise,
        exerciseName: c.exerciseName,
        emoji: ex?.emoji || '💪',
        unit: ex?.unit || 'раз',
        isAttacker,
        myTarget: isAttacker ? c.attackerTarget : c.defenderTarget,
        opponentTarget: isAttacker ? c.defenderTarget : c.attackerTarget,
        myDone: isAttacker ? c.attackerDone : c.defenderDone,
        opponentDone: isAttacker ? c.defenderDone : c.attackerDone,
        myStarted: Boolean(isAttacker ? c.attackerStartedAt : c.defenderStartedAt),
        opponentName: names.get(isAttacker ? c.defenderId : c.attackerId) ?? null,
        expiresAt: c.expiresAt,
        trophyReward: c.trophyReward,
        xpReward: c.xpReward,
      };
    });

    return { challenges: enriched };
  });

  // --- GET /challenge/history — Past challenges ---
  app.get('/challenge/history', async (request) => {
    const userId = request.userId;
    const challenges = await prisma.challenge.findMany({
      where: {
        status: { in: ['completed', 'expired'] },
        OR: [{ attackerId: userId }, { defenderId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const names = await loadNames(challenges);

    const enriched = challenges.map((c) => {
      const isAttacker = c.attackerId === userId;
      return {
        id: c.id,
        exerciseName: c.exerciseName,
        status: c.status,
        isAttacker,
        won: c.winnerId === userId,
        isDraw: c.status === 'completed' && !c.winnerId,
        opponentName: names.get(isAttacker ? c.defenderId : c.attackerId) ?? null,
        myTime: isAttacker ? c.attackerTime : c.defenderTime,
        oppTime: isAttacker ? c.defenderTime : c.attackerTime,
        trophyReward: c.trophyReward,
        createdAt: c.createdAt,
      };
    });

    return { challenges: enriched };
  });
}
