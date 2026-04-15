import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

// ===== RANK SYSTEM =====
const RANKS = [
  { name: 'bronze', minTrophies: 0, label: 'Бронза' },
  { name: 'silver', minTrophies: 100, label: 'Серебро' },
  { name: 'gold', minTrophies: 300, label: 'Золото' },
  { name: 'platinum', minTrophies: 600, label: 'Платина' },
  { name: 'diamond', minTrophies: 1000, label: 'Алмаз' },
  { name: 'master', minTrophies: 1500, label: 'Мастер' },
  { name: 'legend', minTrophies: 2500, label: 'Легенда' },
];

const RARITY_POWER: Record<string, number> = {
  common: 5,
  rare: 15,
  epic: 30,
  legendary: 50,
};

function getRank(trophies: number): string {
  let rank = 'bronze';
  for (const r of RANKS) {
    if (trophies >= r.minTrophies) rank = r.name;
  }
  return rank;
}

// ===== POWER CALCULATION =====
// Power = Level*10 + Streak*5 + Health*2 + Equipment bonuses
async function calculatePowerScore(userId: string): Promise<{
  total: number;
  breakdown: { level: number; streak: number; health: number; equipment: number };
}> {
  const pet = await prisma.pet.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!pet) return { total: 0, breakdown: { level: 0, streak: 0, health: 0, equipment: 0 } };

  const levelPower = pet.level * 10;
  const streakPower = pet.streak * 5;
  const healthPower = Math.round(pet.health * 2);

  // Equipment power: sum of rarity bonuses for equipped items
  let equipmentPower = 0;
  const equippedKeys = [
    pet.equippedHelmet, pet.equippedArmor, pet.equippedWeapon,
    pet.equippedShield, pet.equippedBoots, pet.equippedAura,
  ].filter(Boolean) as string[];

  for (const key of equippedKeys) {
    const item = pet.items.find(i => i.itemKey === key);
    if (item) {
      equipmentPower += RARITY_POWER[item.rarity] || 0;
      equipmentPower += Math.round(item.bonusValue);
    }
  }

  // Bonus for having all 6 slots equipped
  if (equippedKeys.length === 6) {
    equipmentPower += 25; // Full set bonus
  }

  const total = levelPower + streakPower + healthPower + equipmentPower;

  return {
    total,
    breakdown: { level: levelPower, streak: streakPower, health: healthPower, equipment: equipmentPower },
  };
}

// ===== BATTLE RESOLUTION =====
function resolveBattle(
  attackerPower: number,
  defenderPower: number,
): { attackerRoll: number; defenderRoll: number; winnerId: 'attacker' | 'defender' | 'draw' } {
  // Add ±15% randomness so weaker players have a chance
  const attackerRoll = attackerPower * (0.85 + Math.random() * 0.30);
  const defenderRoll = defenderPower * (0.85 + Math.random() * 0.30);

  const diff = Math.abs(attackerRoll - defenderRoll);
  const threshold = Math.max(attackerPower, defenderPower) * 0.02; // 2% threshold for draw

  let winnerId: 'attacker' | 'defender' | 'draw';
  if (diff < threshold) {
    winnerId = 'draw';
  } else if (attackerRoll > defenderRoll) {
    winnerId = 'attacker';
  } else {
    winnerId = 'defender';
  }

  return {
    attackerRoll: Math.round(attackerRoll * 10) / 10,
    defenderRoll: Math.round(defenderRoll * 10) / 10,
    winnerId,
  };
}

// Generate battle log narrative
function generateBattleLog(
  attackerName: string, attackerChar: string, attackerRoll: number,
  defenderName: string, defenderChar: string, defenderRoll: number,
  winner: string,
): string {
  const charNames: Record<string, string> = {
    warrior: 'воин', elf: 'эльфийка', mage: 'маг', guardian: 'страж',
  };
  const aChar = charNames[attackerChar] || attackerChar;
  const dChar = charNames[defenderChar] || defenderChar;

  const lines: string[] = [];
  lines.push(`${aChar} ${attackerName} (${attackerRoll}) VS ${dChar} ${defenderName} (${defenderRoll})`);

  if (winner === 'draw') {
    lines.push('Силы равны! Ничья — оба достойны.');
  } else if (winner === 'attacker') {
    lines.push(`${attackerName} одержал победу! Дисциплина решает.`);
  } else {
    lines.push(`${defenderName} устоял! Защита непробиваема.`);
  }

  return lines.join('\n');
}

// ===== ROUTES =====
export async function arenaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- GET /arena/profile — Get or create arena profile ---
  app.get('/arena/profile', async (request) => {
    const userId = request.userId;

    let profile = await prisma.arenaProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      const power = await calculatePowerScore(userId);
      profile = await prisma.arenaProfile.create({
        data: { userId, powerScore: power.total },
      });
    }

    // Recalculate power
    const power = await calculatePowerScore(userId);
    if (Math.abs(power.total - profile.powerScore) > 1) {
      profile = await prisma.arenaProfile.update({
        where: { userId },
        data: { powerScore: power.total, rank: getRank(profile.trophies) },
      });
    }

    const pet = await prisma.pet.findUnique({ where: { userId } });

    return {
      profile,
      power,
      character: pet ? {
        name: pet.name,
        characterType: pet.characterType,
        level: pet.level,
        streak: pet.streak,
      } : null,
      ranks: RANKS,
    };
  });

  // --- POST /arena/find-opponent — Find a suitable opponent ---
  app.post('/arena/find-opponent', async (request) => {
    const userId = request.userId;
    const myPower = await calculatePowerScore(userId);

    // Find opponents within ±30% power range
    const minPower = myPower.total * 0.7;
    const maxPower = myPower.total * 1.3;

    // Get all arena profiles except self
    const opponents = await prisma.arenaProfile.findMany({
      where: {
        userId: { not: userId },
        powerScore: { gte: minPower, lte: maxPower },
      },
      include: {
        user: { select: { id: true, name: true } },
      },
      take: 5,
      orderBy: { powerScore: 'desc' },
    });

    // If not enough opponents in range, widen search
    let finalOpponents = opponents;
    if (opponents.length < 3) {
      finalOpponents = await prisma.arenaProfile.findMany({
        where: { userId: { not: userId } },
        include: {
          user: { select: { id: true, name: true } },
        },
        take: 5,
        orderBy: { powerScore: 'desc' },
      });
    }

    // Enrich with pet data — single batched query instead of N+1
    const opponentIds = finalOpponents.map((op) => op.userId);
    const pets = await prisma.pet.findMany({
      where: { userId: { in: opponentIds } },
      select: {
        userId: true,
        name: true,
        characterType: true,
        level: true,
        streak: true,
      },
    });
    const petByUser = new Map(pets.map((p) => [p.userId, p]));

    // Batch power scores in parallel (each is still a sub-query bundle, but no longer serialized)
    const powerScores = await Promise.all(
      finalOpponents.map((op) => calculatePowerScore(op.userId)),
    );

    const enriched = finalOpponents.map((op, i) => {
      const pet = petByUser.get(op.userId);
      return {
        id: op.id,
        userId: op.userId,
        name: op.user.name,
        trophies: op.trophies,
        rank: op.rank,
        wins: op.wins,
        losses: op.losses,
        powerScore: powerScores[i].total,
        character: pet
          ? {
              name: pet.name,
              characterType: pet.characterType,
              level: pet.level,
              streak: pet.streak,
            }
          : null,
      };
    });

    return { opponents: enriched, myPower };
  });

  // --- POST /arena/battle — Start a battle ---
  app.post('/arena/battle', async (request, reply) => {
    const userId = request.userId;
    const { opponentId } = request.body as { opponentId: string };

    if (!opponentId) {
      return reply.status(400).send({ error: 'opponentId обязателен' });
    }

    // Get or create profiles
    let attackerProfile = await prisma.arenaProfile.findUnique({ where: { userId } });
    if (!attackerProfile) {
      const power = await calculatePowerScore(userId);
      attackerProfile = await prisma.arenaProfile.create({
        data: { userId, powerScore: power.total },
      });
    }

    // Check cooldown (1 battle per 5 minutes)
    if (attackerProfile.lastBattleAt) {
      const cooldown = 5 * 60 * 1000; // 5 minutes
      const timeSince = Date.now() - attackerProfile.lastBattleAt.getTime();
      if (timeSince < cooldown) {
        const remaining = Math.ceil((cooldown - timeSince) / 1000);
        return reply.status(429).send({
          error: `Подожди ${remaining} секунд до следующего боя`,
          cooldownRemaining: remaining,
        });
      }
    }

    const defenderProfile = await prisma.arenaProfile.findUnique({
      where: { userId: opponentId },
    });
    if (!defenderProfile) {
      return reply.status(404).send({ error: 'Противник не найден' });
    }

    // Calculate power scores
    const attackerPower = await calculatePowerScore(userId);
    const defenderPower = await calculatePowerScore(opponentId);

    // Get pet data
    const [attackerPet, defenderPet] = await Promise.all([
      prisma.pet.findUnique({ where: { userId } }),
      prisma.pet.findUnique({ where: { userId: opponentId } }),
    ]);

    const [attackerUser, defenderUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: opponentId }, select: { name: true } }),
    ]);

    // Resolve battle
    const result = resolveBattle(attackerPower.total, defenderPower.total);

    // Calculate trophy changes
    let trophyChange = 0;
    let xpReward = 0;
    let winnerProfileId: string | null = null;

    if (result.winnerId === 'attacker') {
      trophyChange = Math.max(10, Math.round(30 * (defenderPower.total / Math.max(1, attackerPower.total))));
      xpReward = 25;
      winnerProfileId = attackerProfile.id;
    } else if (result.winnerId === 'defender') {
      trophyChange = -Math.max(5, Math.round(15 * (attackerPower.total / Math.max(1, defenderPower.total))));
      xpReward = 10;
      winnerProfileId = defenderProfile.id;
    } else {
      trophyChange = 5; // Draw gives small trophy bonus
      xpReward = 15;
    }

    // Generate battle log
    const log = generateBattleLog(
      attackerUser?.name || 'Атакующий',
      attackerPet?.characterType || 'warrior',
      result.attackerRoll,
      defenderUser?.name || 'Защитник',
      defenderPet?.characterType || 'warrior',
      result.defenderRoll,
      result.winnerId,
    );

    // Create battle record
    const battle = await prisma.battle.create({
      data: {
        attackerId: attackerProfile.id,
        defenderId: defenderProfile.id,
        winnerId: winnerProfileId,
        attackerPower: attackerPower.total,
        defenderPower: defenderPower.total,
        attackerRoll: result.attackerRoll,
        defenderRoll: result.defenderRoll,
        attackerChar: attackerPet?.characterType || 'warrior',
        defenderChar: defenderPet?.characterType || 'warrior',
        attackerLevel: attackerPet?.level || 1,
        defenderLevel: defenderPet?.level || 1,
        trophyChange,
        xpReward,
        log,
      },
    });

    // Update attacker profile
    const newAttackerTrophies = Math.max(0, attackerProfile.trophies + trophyChange);
    const attackerWon = result.winnerId === 'attacker';
    const newWinStreak = attackerWon ? attackerProfile.winStreak + 1 : 0;

    await prisma.arenaProfile.update({
      where: { userId },
      data: {
        trophies: newAttackerTrophies,
        wins: attackerWon ? { increment: 1 } : undefined,
        losses: result.winnerId === 'defender' ? { increment: 1 } : undefined,
        draws: result.winnerId === 'draw' ? { increment: 1 } : undefined,
        winStreak: newWinStreak,
        bestWinStreak: Math.max(attackerProfile.bestWinStreak, newWinStreak),
        rank: getRank(newAttackerTrophies),
        powerScore: attackerPower.total,
        lastBattleAt: new Date(),
        seasonWins: attackerWon ? { increment: 1 } : undefined,
        seasonLosses: result.winnerId === 'defender' ? { increment: 1 } : undefined,
      },
    });

    // Update defender trophies (inverse)
    const defenderTrophyChange = result.winnerId === 'defender'
      ? Math.abs(trophyChange)
      : result.winnerId === 'attacker'
        ? -Math.round(Math.abs(trophyChange) * 0.5)
        : 3;
    const newDefenderTrophies = Math.max(0, defenderProfile.trophies + defenderTrophyChange);

    await prisma.arenaProfile.update({
      where: { userId: opponentId },
      data: {
        trophies: newDefenderTrophies,
        wins: result.winnerId === 'defender' ? { increment: 1 } : undefined,
        losses: result.winnerId === 'attacker' ? { increment: 1 } : undefined,
        draws: result.winnerId === 'draw' ? { increment: 1 } : undefined,
        rank: getRank(newDefenderTrophies),
        powerScore: defenderPower.total,
      },
    });

    // Give XP to attacker's pet
    if (attackerPet && xpReward > 0) {
      await prisma.pet.update({
        where: { userId },
        data: { xp: { increment: xpReward } },
      });
    }

    return {
      battle: {
        id: battle.id,
        result: result.winnerId,
        attackerRoll: result.attackerRoll,
        defenderRoll: result.defenderRoll,
        trophyChange,
        xpReward,
        log,
      },
      attacker: {
        name: attackerUser?.name,
        character: attackerPet?.characterType,
        level: attackerPet?.level,
        power: attackerPower,
        newTrophies: newAttackerTrophies,
      },
      defender: {
        name: defenderUser?.name,
        character: defenderPet?.characterType,
        level: defenderPet?.level,
        power: defenderPower,
        newTrophies: newDefenderTrophies,
      },
    };
  });

  // --- GET /arena/history — Battle history ---
  app.get('/arena/history', async (request) => {
    const userId = request.userId;
    const profile = await prisma.arenaProfile.findUnique({ where: { userId } });

    if (!profile) return { battles: [] };

    const battles = await prisma.battle.findMany({
      where: {
        OR: [
          { attackerId: profile.id },
          { defenderId: profile.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        attacker: { include: { user: { select: { name: true } } } },
        defender: { include: { user: { select: { name: true } } } },
      },
    });

    return {
      battles: battles.map(b => ({
        id: b.id,
        isAttacker: b.attackerId === profile.id,
        won: b.winnerId === profile.id,
        draw: b.winnerId === null,
        opponent: b.attackerId === profile.id
          ? { name: b.defender.user.name, char: b.defenderChar, level: b.defenderLevel }
          : { name: b.attacker.user.name, char: b.attackerChar, level: b.attackerLevel },
        myPower: b.attackerId === profile.id ? b.attackerPower : b.defenderPower,
        oppPower: b.attackerId === profile.id ? b.defenderPower : b.attackerPower,
        trophyChange: b.attackerId === profile.id ? b.trophyChange : -b.trophyChange,
        xpReward: b.xpReward,
        log: b.log,
        createdAt: b.createdAt,
      })),
    };
  });

  // --- GET /arena/leaderboard — Top players ---
  app.get('/arena/leaderboard', async (request) => {
    const userId = request.userId;

    const top = await prisma.arenaProfile.findMany({
      orderBy: { trophies: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    // Batched pet lookup — one query instead of 50
    const topUserIds = top.map((t) => t.userId);
    const pets = await prisma.pet.findMany({
      where: { userId: { in: topUserIds } },
      select: { userId: true, characterType: true, level: true, name: true },
    });
    const petByUser = new Map(pets.map((p) => [p.userId, p]));

    const leaderboard = top.map((entry, idx) => {
      const pet = petByUser.get(entry.userId);
      return {
        rank: idx + 1,
        userId: entry.userId,
        name: entry.user.name,
        trophies: entry.trophies,
        arenaRank: entry.rank,
        wins: entry.wins,
        losses: entry.losses,
        winStreak: entry.bestWinStreak,
        powerScore: entry.powerScore,
        isMe: entry.userId === userId,
        character: pet
          ? { name: pet.name, type: pet.characterType, level: pet.level }
          : null,
      };
    });

    // My position + total — batched in parallel
    const [myProfile, totalPlayers] = await Promise.all([
      prisma.arenaProfile.findUnique({ where: { userId } }),
      prisma.arenaProfile.count(),
    ]);

    let myPosition = null;
    if (myProfile) {
      const above = await prisma.arenaProfile.count({
        where: { trophies: { gt: myProfile.trophies } },
      });
      myPosition = above + 1;
    }

    return { leaderboard, myPosition, totalPlayers };
  });
}
