import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import {
  shouldSynthesize,
  parseProfile,
  type SynthGate,
} from './profile-core.js';

/**
 * Phase 6 C2.3 — синтезатор профиля (glue). Решения:
 *  - UserProfile = ПРОИЗВОДНАЯ вьюха над Memory (#4 SSOT) —
 *    Memory остаётся источником, тут только кэш синтеза;
 *  - C1(d) ИНВАРИАНТ: synthesizer — НОВЫЙ читатель ChatMessage,
 *    обязан фильтровать crisis=false (кризис НЕ обучает профиль —
 *    провал-инвариант спеки #6). Закреплено source-тестом;
 *  - дешёвый cadence/active-gate (profile-core) ДО Sonnet;
 *  - Sonnet 1×/нед; мусор НЕ персистим (parseProfile→null → skip);
 *  - НЕ-фатально (сбой/нет ключа → профиль не трогаем).
 */

const WEEK_MS = 7 * 86_400_000;

async function gather(userId: string, now: Date) {
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const since90d = new Date(now.getTime() - 90 * 86_400_000);

  const [profile, interactions7d, messages, memories, insights, doneTasks, doneHabitLogs] =
    await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: { lastSynthesizedAt: true },
      }),
      // C1(d): crisis-ходы НЕ считаются и НЕ читаются для профиля.
      prisma.chatMessage.count({
        where: { userId, crisis: false, createdAt: { gte: since7d } },
      }),
      prisma.chatMessage.findMany({
        where: { userId, crisis: false },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { role: true, content: true, createdAt: true },
      }),
      prisma.memory.findMany({
        where: { userId, importance: { gte: 5 } },
        orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
        take: 80,
        select: { type: true, content: true, tags: true, createdAt: true },
      }),
      prisma.insight.findMany({
        where: { userId, source: 'reflector' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { kind: true, message: true, createdAt: true },
      }),
      prisma.task.count({
        where: { userId, completed: true, date: { gte: since90d } },
      }),
      prisma.habitLog.count({
        where: { userId, completed: true, date: { gte: since90d } },
      }),
    ]);

  const last = profile?.lastSynthesizedAt ?? null;
  const newest = (d: Date | undefined) => (d ? d.getTime() : 0);
  const newDataSince =
    last === null ||
    newest(messages[0]?.createdAt) > last.getTime() ||
    newest(memories[0]?.createdAt) > last.getTime() ||
    newest(insights[0]?.createdAt) > last.getTime();

  return {
    lastSynthesizedAt: last,
    interactions7d,
    newDataSince,
    messages,
    memories,
    insights,
    doneTasks,
    doneHabitLogs,
  };
}

function buildCorpus(g: Awaited<ReturnType<typeof gather>>): string {
  const msgs = g.messages
    .slice(0, 120)
    .reverse()
    .map((m) => `${m.role === 'assistant' ? 'A' : 'U'}: ${m.content}`)
    .join('\n')
    .slice(0, 12000);
  const mem = g.memories
    .map((m) => `[${m.type}] ${m.content}${m.tags.length ? ` (${m.tags.join(',')})` : ''}`)
    .join('\n')
    .slice(0, 6000);
  const ins = g.insights.map((i) => `- ${i.kind}: ${i.message}`).join('\n');
  return (
    `ДИАЛОГ (последние реплики):\n${msgs}\n\n` +
    `ПАМЯТЬ (важное, importance≥5):\n${mem}\n\n` +
    `РЕФЛЕКТОР (наблюдения):\n${ins || '—'}\n\n` +
    `ВЫПОЛНЕНО за 90д: задач ${g.doneTasks}, привычек ${g.doneHabitLogs}.`
  );
}

const SYSTEM =
  'Ты синтезируешь СТАБИЛЬНЫЙ характер пользователя из его данных. ' +
  'Только то, что подтверждается материалом — НЕ выдумывай. Верни ' +
  'ТОЛЬКО JSON без обёрток: {"values":[..],"triggers":[..],' +
  '"patterns":[..],"styleNotes":"...","relationships":{"имя":"суть"}}. ' +
  'values — глубинные ценности; triggers — что задевает; patterns — ' +
  'поведенческие паттерны (напр. «бросает привычки на 3-й неделе»); ' +
  'styleNotes — как с ним лучше говорить; relationships — ключевые ' +
  'люди и суть отношения. Коротко, по-русски, по делу.';

/**
 * Один прогон синтеза для юзера. Каденс/активность — profile-core
 * (дёшево, ДО Sonnet). Возвращает что произошло (для cron-логов).
 */
export async function runProfileSynthesis(
  userId: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; persisted: boolean; reason?: string }> {
  const g = await gather(userId, now);
  const gate: SynthGate = {
    lastSynthesizedAt: g.lastSynthesizedAt,
    now,
    interactions7d: g.interactions7d,
    newDataSince: g.newDataSince,
  };
  if (!shouldSynthesize(gate)) {
    return { ran: false, persisted: false, reason: 'gate' };
  }

  // FIX (P6-safety 2026-05-28): проект использует CLAUDE_API_KEY (см.
  // .env.example + routes/quick-add.ts bug-fix комментарий). Раньше
  // SDK-дефолтный env-name → ключа нет в Railway → синтезатор тихо
  // отключён → UserProfile = 0 rows в проде (inspect-memory.ts).
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return { ran: true, persisted: false, reason: 'no-key' };

  let raw = '';
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildCorpus(g) }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    raw = block && block.type === 'text' ? block.text : '';
  } catch (err) {
    console.warn(
      '[profile] Sonnet failed (non-fatal, profile untouched):',
      err instanceof Error ? err.message : err,
    );
    return { ran: true, persisted: false, reason: 'sonnet-error' };
  }

  const p = parseProfile(raw);
  if (!p) return { ran: true, persisted: false, reason: 'unparseable' };

  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      values: p.values,
      triggers: p.triggers,
      patterns: p.patterns,
      styleNotes: p.styleNotes,
      relationships: p.relationships,
      lastSynthesizedAt: now,
      synthesisVersion: 1,
    },
    update: {
      values: p.values,
      triggers: p.triggers,
      patterns: p.patterns,
      styleNotes: p.styleNotes,
      relationships: p.relationships,
      lastSynthesizedAt: now,
      synthesisVersion: 1,
    },
  });
  return { ran: true, persisted: true };
}

/**
 * C2.5 — каденс раз/неделю/юзер (tz не критичен: окно недельное,
 * не дневное). Идемпотентно: gate в profile-core отсечёт <недели.
 */
export async function runProfileSynthesisWeekly(
  userId: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; persisted: boolean; reason?: string }> {
  const prof = await prisma.userProfile.findUnique({
    where: { userId },
    select: { lastSynthesizedAt: true },
  });
  const last = prof?.lastSynthesizedAt;
  if (last && now.getTime() - last.getTime() < WEEK_MS) {
    return { ran: false, persisted: false, reason: 'weekly-cadence' };
  }
  return runProfileSynthesis(userId, now);
}
