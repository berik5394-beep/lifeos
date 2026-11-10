/**
 * Что робот сам говорил о себе (L, 2026-11-10, аудит друга): «мне нравится
 * джаз», «люблю, когда ты рассказываешь о планах» — раньше нигде не
 * запоминалось, и в другой день робот мог сказать обратное. Храним до 12
 * последних фраз в User.settings.robotSelf (не в памяти человека — это не
 * факты о нём) и показываем мозгу: «не противоречь».
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { trigramSimilarity } from '../lib/fuzzy.js';

const KEEP = 12;
const SHOW = 5;
/** Робот говорит длинно — фразу до 240 символов берём, храним до 200. */
const MAX_LEN = 240;
const STORE_LEN = 200;

/** Фраза робота о СЕБЕ: вкус, предпочтение, что интересно (первое лицо). */
const SELF =
  /(?:^|[^а-яё])(?:мне\s+(?:[а-яё-]+\s+){0,2}?(?:нравится|нравятся|интересно|интересны|близк[оиа]|ближе|дорог[оиа]|запоминается|запоминаются|запомнилось|запомнилась|откликается|откликаются|по\s+душе)|я\s+(?:[а-яё-]+\s+){0,2}?(?:люблю|обожаю|предпочитаю|ценю)|мой\s+любимый|моя\s+любимая|моё\s+любимое|мое\s+любимое|мои\s+любимые)(?![а-яё])/i;
/** Пересказ слов человека / вопрос к нему — не о роботе. */
const NOT_SELF = /(?:^|[^а-яё])(?:ты|тебе|тебя|твой|твоя|твои|вы|вам)\s+(?:тоже\s+)?(?:нравится|любишь|любите|обожаешь)|\?\s*$/i;

/** Фразы робота о себе из ответа (чистая). */
export function selfStatements(reply: string): string[] {
  return reply
    .split(/(?<=[.!…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= MAX_LEN && SELF.test(s) && !NOT_SELF.test(s))
    .map((s) => (s.length > STORE_LEN ? `${s.slice(0, STORE_LEN - 1)}…` : s));
}

/** Добавить новые фразы к старым: без почти-повторов, последние KEEP (чистая). */
export function mergeSelf(old: string[], fresh: string[]): string[] {
  const out = [...old];
  for (const f of fresh) {
    // Сравниваем суть без общего зачина («мне нравится …»), иначе «джаз» = «горы».
    const core = (x: string) => x.replace(SELF, ' ').trim();
    const i = out.findIndex((o) => trigramSimilarity(core(o), core(f)) >= 0.6);
    if (i >= 0) out.splice(i, 1);
    out.push(f);
  }
  return out.slice(-KEEP);
}

/** После ответа робота: запомнить, что он сказал о себе. Никогда не бросает. */
export async function rememberRobotSelf(userId: string, reply: string): Promise<number> {
  try {
    const fresh = selfStatements(reply);
    if (fresh.length === 0) return 0;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    const old = (((u?.settings ?? {}) as { robotSelf?: unknown }).robotSelf as string[] | undefined) ?? [];
    const next = mergeSelf(Array.isArray(old) ? old.filter((x) => typeof x === 'string') : [], fresh);
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "User" SET settings = COALESCE(settings::jsonb, '{}'::jsonb) || jsonb_build_object('robotSelf', ${JSON.stringify(next)}::jsonb) WHERE id = ${userId}`,
    );
    return fresh.length;
  } catch (err) {
    console.warn('[robot-self] failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Строка для мозга (чистая). */
export function formatRobotSelf(said: string[]): string | null {
  const last = said.slice(-SHOW);
  if (last.length === 0) return null;
  return `Что ты раньше говорил о себе (держись этого, не противоречь; повторять не нужно): ${last.map((s) => `«${s}»`).join('; ')}.`;
}
