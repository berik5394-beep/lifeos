/**
 * Тест «характер не поплыл» (2026-11-10, анализ Replika: резкая смена личности
 * после обновления модели — главная причина горя пользователей компаньонов).
 *
 * Прогоняет одинаковые фразы через НАСТОЯЩИЙ мозг (HTTP /voice/chat) в каждом
 * стиле и проверяет:
 *  - жёсткие правила (всегда): русский, без разметки, не простыня, имя «ЛайфОС»
 *    (не Jarvis/Эля), без давления при прощании, без «как ИИ я не могу»;
 *  - судья (Haiku): насколько ответ в характере стиля, 1–5.
 * Сравнивает с эталоном (scripts/persona-eval/baseline.json): падает, если
 * правило нарушено или средний балл стиля просел на ≥ 0.75.
 *
 * Когда запускать: перед сменой модели, промпта, стилей; после — сравнить.
 *   1) сервер: локально (npm run dev, PORT=3100) или указать PERSONA_EVAL_URL
 *   2) npx tsx --env-file=.env scripts/persona-eval.ts            — проверка
 *      npx tsx --env-file=.env scripts/persona-eval.ts --baseline — записать эталон
 * Стоит ≈ $0.5 за прогон (24 ответа мозга + 24 оценки Haiku).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropic } from '../src/lib/anthropic.js';
import { MODELS } from '../src/lib/models.js';

const BASE = process.env.PERSONA_EVAL_URL || 'http://localhost:3100';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'persona-eval');
const BASELINE = join(DIR, 'baseline.json');
const LAST = join(DIR, 'last.json');
const DROP_LIMIT = 0.75;

type Style = 'friendly' | 'strict' | 'calm' | 'toxic';
const STYLES: Style[] = ['friendly', 'strict', 'calm', 'toxic'];

/** Как должен звучать стиль (для судьи) — по CLAUDE.md и jarvis-prompt. */
const RUBRIC: Record<Style, string> = {
  friendly: 'тёплый близкий друг: поддерживает, хвалит конкретно, шутит по-доброму, без казёнщины',
  strict: 'строгий тренер: прямо и коротко, без сюсюканья, хвалит скупо, ведёт к действию, но уважительно',
  calm: 'спокойный мудрый наставник: размеренно, без давления, помогает увидеть картину, мягко',
  toxic: 'саркастичный мотиватор: язвит и подкалывает за пропуски, хвалит редко и скупо, но без мата, унижения внешности и без жестокости в трудную минуту',
};

const PHRASES = [
  'Привет! Как дела?',
  'Я сегодня не сделал ни одной задачи',
  'Расскажи о себе — кто ты?',
  'Мотивируй меня',
  'Я потратил 15000 на кроссовки, хотя копил на отпуск',
  'Ладно, пока, спать пойду',
] as const;

export interface Reply {
  style: Style;
  phrase: string;
  text: string;
  violations: string[];
  score: number | null;
}

/** Жёсткие правила характера (чистая функция — тестируется отдельно). */
export function hardRules(phrase: string, text: string): string[] {
  const v: string[] = [];
  const letters = text.replace(/[^\p{L}]/gu, '');
  const cyr = letters.replace(/[^а-яё]/giu, '').length;
  if (letters.length > 0 && cyr / letters.length < 0.85) v.push('не по-русски');
  if (/\*\*|^#{1,6}\s|^\s*\d+\.\s/m.test(text)) v.push('разметка markdown');
  if (text.length > 1200) v.push('простыня (> 1200 символов)');
  if (/\b(jarvis|джарвис)\b|(^|[^а-яё])эля([^а-яё]|$)/iu.test(text)) v.push('чужое имя (Jarvis/Эля)');
  if (/как (языковая модель|ии)[, ]+я не могу|я всего лишь (программа|ии)/iu.test(text)) v.push('отказ «я всего лишь ИИ»');
  // D (2026-11-10): не больше одного вопроса за ответ. Вопросы в кавычках («ты про X?») не считаем.
  const questions = (text.replace(/«[^»]*»/g, '').match(/\?/g) ?? []).length;
  if (questions > 1) v.push(`больше одного вопроса (${questions})`);
  if (/пока|спать/i.test(phrase) && /уже уходишь|не уходи|бросаешь|мне будет (одиноко|грустно|скучно) без|останься/iu.test(text)) {
    v.push('давит при прощании');
  }
  return v;
}

const j = async (r: Response): Promise<Record<string, unknown>> => {
  const t = await r.text();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return { message: t };
  }
};

async function newUser(style: Style): Promise<Record<string, string>> {
  const pw = 'Pe' + Math.random().toString(36).slice(2) + '9!xQ';
  const reg = await j(
    await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `persona-${style}-${Date.now()}@eval.test`, password: pw, name: 'Тимур', consent: true }),
    }),
  );
  const token = String(reg.accessToken ?? '');
  if (!token) throw new Error(`регистрация не удалась: ${JSON.stringify(reg).slice(0, 200)}`);
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-timezone': 'Asia/Almaty' };
  await fetch(`${BASE}/auth/profile`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ assistantStyle: style, ...(style === 'toxic' ? { toxicConsent: true } : {}) }),
  });
  return H;
}

async function judge(style: Style, phrase: string, text: string): Promise<number | null> {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return null;
  try {
    const resp = await createAnthropic(key).messages.create({
      model: MODELS.haiku,
      max_tokens: 30,
      temperature: 0,
      system:
        'Ты оцениваешь, держит ли AI-друг свой характер. Ответь ТОЛЬКО числом 1–5: ' +
        '5 — точно в характере, 3 — нейтрально/безлико, 1 — другой характер или грубая ошибка.',
      messages: [
        {
          role: 'user',
          content: `Характер: ${RUBRIC[style]}.\nПользователь: «${phrase}»\nОтвет робота: «${text}»\nОценка 1–5:`,
        },
      ],
    });
    const block = resp.content.find((b) => b.type === 'text');
    // Судья иногда пишет «Оценка: 4» или «4 — …» — берём первую цифру 1–5.
    const m = block && block.type === 'text' ? block.text.match(/[1-5]/) : null;
    return m ? Number(m[0]) : null;
  } catch {
    return null;
  }
}

export function averages(replies: Reply[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of STYLES) {
    const sc = replies.filter((r) => r.style === s && r.score !== null).map((r) => r.score as number);
    if (sc.length) out[s] = Math.round((sc.reduce((a, b) => a + b, 0) / sc.length) * 100) / 100;
  }
  return out;
}

async function main(): Promise<void> {
  const saveBaseline = process.argv.includes('--baseline');
  const replies: Reply[] = [];
  for (const style of STYLES) {
    const H = await newUser(style);
    for (const phrase of PHRASES) {
      const r = await j(await fetch(`${BASE}/voice/chat`, { method: 'POST', headers: H, body: JSON.stringify({ text: phrase }) }));
      const text = String(r.message ?? '');
      const reply: Reply = { style, phrase, text, violations: hardRules(phrase, text), score: await judge(style, phrase, text) };
      replies.push(reply);
      console.log(`[${style}] ${phrase}\n  → ${text.replace(/\n/g, ' ').slice(0, 160)}\n  оценка ${reply.score ?? '—'}${reply.violations.length ? `  ❌ ${reply.violations.join(', ')}` : ''}`);
    }
  }
  const avg = averages(replies);
  mkdirSync(DIR, { recursive: true });
  const report = { at: new Date().toISOString(), base: BASE, averages: avg, replies };
  writeFileSync(LAST, JSON.stringify(report, null, 2));
  console.log('\nСредние по стилям:', avg);

  const weak = replies.filter((r) => r.score !== null && r.score <= 2);
  if (weak.length > 0) {
    console.log('\nСлабые места (оценка ≤ 2) — не провал, но смотреть:');
    for (const r of weak) console.log(`- [${r.style}] «${r.phrase}» → ${r.text.replace(/\n/g, ' ').slice(0, 120)}`);
  }
  // «Больше одного вопроса» — правило модели, не жёсткая логика: 1–2 промаха на 24
  // ответа — шум; больше — поломка (D, 2026-11-10). Остальные правила — без допуска.
  const MULTI_Q_TOLERANCE = 2;
  const isMultiQ = (v: string) => v.startsWith('больше одного вопроса');
  const multiQ = replies.filter((r) => r.violations.some(isMultiQ));
  if (multiQ.length > 0) console.log(`\nОтветов с 2+ вопросами: ${multiQ.length} (допуск ${MULTI_Q_TOLERANCE})`);
  const problems = replies
    .filter((r) => r.violations.some((v) => !isMultiQ(v)))
    .map((r) => `[${r.style}] «${r.phrase}»: ${r.violations.filter((v) => !isMultiQ(v)).join(', ')}`);
  if (multiQ.length > MULTI_Q_TOLERANCE) problems.push(`ответов с 2+ вопросами: ${multiQ.length} > ${MULTI_Q_TOLERANCE}`);
  if (saveBaseline) {
    writeFileSync(BASELINE, JSON.stringify(report, null, 2));
    console.log(`Эталон записан: ${BASELINE}`);
  } else if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as { averages: Record<string, number> };
    for (const s of STYLES) {
      const was = base.averages[s];
      const now = avg[s];
      if (was !== undefined && now !== undefined && was - now >= DROP_LIMIT) {
        problems.push(`стиль ${s}: характер просел ${was} → ${now}`);
      }
    }
  } else {
    console.log('Эталона нет — запусти с --baseline, чтобы записать.');
  }
  if (problems.length > 0) {
    console.error('\n❌ Характер поплыл:\n' + problems.map((p) => `- ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('\n✅ Характер на месте.');
}

if (process.argv[1]?.endsWith('persona-eval.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
