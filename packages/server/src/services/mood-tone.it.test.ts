import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEmotionalMemory } from './emotional-memory.singleton.js';

// Срез mood-tone, Task 4 — it-тест честности СИГНАЛА detectMoodShift:
// сидим MoodSnapshot напрямую → реальный спад даёт {shifted:true, direction:'down'},
// ровное настроение — НЕ down. Сквозь filterCandidates НЕ гоняем (gate1_DND
// зависит от текущего часа = флаки; глушение покрыто чистым юнитом).
//
// Фактические окна detectMoodShift (emotional-memory.ts:271-302):
//   recent   = recordedAt >= now − 3д (нужно ≥3 строк)
//   baseline = now − 17д … now − 3д   (нужно ≥5 строк)
//   фильтр source='message'; порог magnitude ≥ 1.0.
// computeShiftMagnitude (строка 189): sd===0 → fallback на |diff| (guard ЕСТЬ,
// деления на 0 нет). Но при baseline ровно 0.5×6 magnitude = |−0.5−0.5| = 1.0 —
// РОВНО на границе порога ≥1.0. Поэтому baseline слегка разнообразен
// (0.4/0.5/0.6, среднее 0.5): sd≈0.089 → magnitude ≈ 11 — далеко от границы.
//
// Pattern from open-loops.it.test.ts: own PrismaClient, disconnect in afterAll.
// Каждый it-блок стартует на чистой БД (setup.ts → beforeEach → resetDb).
const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `it-mood-${tag}@it.local`,
      name: 'IT',
      passwordHash: 'x',
      timezone: 'Asia/Almaty',
    },
  });
  return u.id;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe('mood-tone — сигнал detectMoodShift', () => {
  it('baseline высокий + recent низкий → shifted down', async () => {
    const uid = await mkUser(`d-${Date.now()}`);
    // baseline: 6 строк в днях 5..15 назад (внутри окна 3–17д, с запасом от
    // границ). Valence 0.4/0.5/0.6 поочерёдно — среднее 0.5, sd>0 (см. шапку).
    const baselineValence = [0.4, 0.5, 0.6];
    for (let i = 0; i < 6; i++) {
      await prisma.moodSnapshot.create({
        data: {
          userId: uid,
          source: 'message',
          valence: baselineValence[i % 3]!,
          arousal: 0.5,
          emotion: 'happy',
          recordedAt: daysAgo(5 + i * 2), // 5,7,9,11,13,15 дней назад
        },
      });
    }
    // recent: 3 строки valence −0.5 в последний день (внутри окна <3д).
    for (let i = 0; i < 3; i++) {
      await prisma.moodSnapshot.create({
        data: {
          userId: uid,
          source: 'message',
          valence: -0.5,
          arousal: 0.5,
          emotion: 'sad',
          recordedAt: daysAgo(i * 0.5), // 0, 0.5, 1 день назад
        },
      });
    }
    const shift = await getEmotionalMemory().detectMoodShift(uid);
    expect(shift?.shifted).toBe(true);
    expect(shift?.direction).toBe('down');
  });

  it('ровное настроение → не down', async () => {
    const uid = await mkUser(`f-${Date.now()}`);
    // Сиды заполняют ОБА окна (3 recent + 6 baseline), чтобы пройти гейты
    // recent≥3/baseline≥5 и проверить РЕАЛЬНЫЙ путь «нет сдвига»
    // ({shifted:false}, diff=0), а не early-return null «мало данных».
    for (let i = 0; i < 3; i++) {
      await prisma.moodSnapshot.create({
        data: {
          userId: uid,
          source: 'message',
          valence: 0.3,
          arousal: 0.5,
          emotion: 'happy',
          recordedAt: daysAgo(i * 0.5), // recent: 0, 0.5, 1 день назад
        },
      });
    }
    for (let i = 0; i < 6; i++) {
      await prisma.moodSnapshot.create({
        data: {
          userId: uid,
          source: 'message',
          valence: 0.3,
          arousal: 0.5,
          emotion: 'happy',
          recordedAt: daysAgo(4 + i * 2), // baseline: 4,6,8,10,12,14 дней назад
        },
      });
    }
    const shift = await getEmotionalMemory().detectMoodShift(uid);
    // null (нет данных) тоже был бы «не down», но сиды гарантируют
    // {shifted:false} — настоящий вердикт «ровно».
    expect(shift?.shifted === true && shift?.direction === 'down').toBeFalsy();
  });
});
