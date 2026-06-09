import { writeFile, unlink } from 'fs/promises';
import { MODELS } from '../lib/models.js';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'node:crypto';
import { createAnthropic } from '../lib/anthropic.js';
import Groq from 'groq-sdk';
import { prisma } from '../lib/prisma.js';
import { AiModelError } from '../lib/errors.js';

/**
 * Переиспользуемый пайплайн диктофона: audio → Whisper (Groq) → Claude
 * extraction → запись задач + memories в БД.
 *
 * Используется в двух местах:
 *  - HTTP route POST /dictation/process (мобилка)
 *  - Telegram-бот (голосовые сообщения)
 *
 * Один источник истины — логика не дублируется между интерфейсами.
 */

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
const anthropic = createAnthropic();

export interface ExtractedTask {
  title: string;
  date?: string;
  time?: string;
  category?: string;
  priority?: string;
  notes?: string;
}

export interface ExtractedMemory {
  type: 'fact' | 'decision' | 'event' | 'person' | 'place' | 'preference' | 'emotion';
  content: string;
  details?: string;
  tags?: string[];
  importance?: number;
}

export interface DictationExtraction {
  summary: string;
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  spokenResponse: string;
}

export interface DictationResult {
  sessionId: string;
  transcript: string;
  summary: string;
  spokenResponse: string;
  tasksCreated: Array<{ id: string; title: string; date: Date; time: string | null; category: string }>;
  memoriesCreated: Array<{ id: string; type: string; content: string; importance: number; tags: string[] }>;
}

/** Whisper STT через Groq. Принимает base64, возвращает текст. */
export async function transcribeAudio(audioB64: string, format: string): Promise<string> {
  const tmp = join(tmpdir(), `dictation-${crypto.randomUUID()}.${format}`);
  await writeFile(tmp, Buffer.from(audioB64, 'base64'));
  try {
    const { createReadStream } = await import('fs');
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmp) as unknown as File,
      model: 'whisper-large-v3',
      language: 'ru',
      response_format: 'text',
    });
    return typeof transcription === 'string'
      ? transcription
      : (transcription as { text?: string }).text || '';
  } finally {
    await unlink(tmp).catch((e) =>
      console.warn('[dictation] tmp cleanup failed:', e instanceof Error ? e.message : e),
    );
  }
}

/** Claude извлекает из транскрипта структуру: задачи + memories + ответ. */
export async function extractFromTranscript(
  transcript: string,
  userName: string,
): Promise<DictationExtraction> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const systemPrompt = `Ты — JARVIS-помощник пользователя ${userName}. Юзер только что наговорил тебе свободную речь через диктофон. Твоя задача — извлечь оттуда самое важное и вернуть структурированный JSON.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

Верни ТОЛЬКО валидный JSON без markdown, такого формата:
{
  "summary": "1-3 предложения краткой сводки что было сказано",
  "tasks": [
    { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM или null", "category": "work|personal|health|finance|education|home", "priority": "low|medium|high|critical", "notes": "опц." }
  ],
  "memories": [
    { "type": "fact|decision|event|person|place|preference|emotion", "content": "короткая суть", "details": "опц.", "tags": ["..."], "importance": 1-10 }
  ],
  "spokenResponse": "Что ассистент скажет юзеру вслух — короткое подтверждение, 1-2 предложения, тёплый дружеский тон"
}

Правила извлечения:
1. **tasks** — только явные действия ("надо позвонить маме", "купить продукты"). Не выдумывай. Дата — если не указана, ставь сегодня. Категория — выбери логичную, по умолчанию "personal".
2. **memories** — извлекай разные типы:
   - **fact** — факт о ком-то/чём-то ("Серик переехал в Астану", "У мамы день рождения 15 марта")
   - **decision** — принятое решение ("Решили встретиться в субботу")
   - **event** — событие в прошлом ("Был на встрече с инвестором")
   - **person** — упоминание человека впервые ("Познакомился с Айгерим")
   - **place** — место ("Хорошее кафе на Розыбакиева")
   - **preference** — предпочтение юзера ("Не люблю острое")
   - **emotion** — эмоциональное состояние ("Чувствую тревогу из-за работы")
3. **importance** — 1-3 мелочь, 4-6 средне, 7-10 важно (семья, здоровье, большие решения).
4. **summary** — 1-3 предложения. Без воды.
5. **spokenResponse** — что ассистент скажет в ответ. ТЁПЛО, кратко, по-человечески. Например: "Записал. Создал 2 задачи, запомнил про Серика. Что-то ещё?". НЕ цитируй юзера, не повторяй детально.
6. Если транскрипт пустой/мусор/неразборчивый — возвращай пустые arrays и summary="Не разобрал, попробуй ещё раз", spokenResponse="Не разобрал, давай ещё раз?".`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: transcript }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }

  let text = content.text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  try {
    return JSON.parse(text) as DictationExtraction;
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}

/** T4: консервативный чат-экстрактор. Чат ≠ диктофон — «не уверен → молчим». */
export async function extractFromChat(
  text: string,
  userName: string,
): Promise<Pick<DictationExtraction, 'tasks' | 'memories'>> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const systemPrompt = `Ты — фоновый экстрактор памяти ассистента ${userName}. Пользователь написал тебе сообщение в ЧАТЕ (обычная переписка, не диктофон, не монолог). Извлеки ТОЛЬКО то, что действительно стоит запомнить надолго, и верни строгий JSON.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

ГЛАВНОЕ ПРАВИЛО: точность важнее полноты. Сомневаешься — НЕ извлекай. Лучше пустой массив, чем выдуманный факт. Не достраивай, не предполагай, не «читай между строк».

Верни ТОЛЬКО валидный JSON без markdown:
{
  "tasks": [ { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM|null", "category": "work|personal|health|finance|education|home", "priority": "low|medium|high|critical", "notes": "опц." } ],
  "memories": [ { "type": "fact|decision|event|person|place|preference", "content": "короткая суть", "details": "опц.", "tags": ["..."], "importance": 4-10 } ]
}

МОЖНО в memories (только явное, прямо сказанное пользователем):
- fact — конкретный факт, прямо названный («У мамы день рождения 15 марта»)
- decision — принятое решение («Решил уволиться», «Договорились в субботу»)
- event — конкретное прошедшее событие («Был на встрече с инвестором»)
- person — человек, явно названный по имени с контекстом («Познакомился с Айгерим, она дизайнер»)
- place — конкретное место с контекстом («Хорошее кафе на Розыбакиева»)
- preference — устойчивое предпочтение, прямо высказанное («Не люблю острое»)

НЕЛЬЗЯ (верни пусто):
- эмоции/настроение («устал», «тревожно», «отлично») — НЕ извлекаем вообще
- мимолётные реплики, вопросы, болтовню («ок», «спасибо», «не знаю»)
- неуверенное/гипотетическое («наверное», «может быть», «если получится»)
- то, что ты сам додумал из контекста

importance: 4-6 обычный факт, 7-10 важное (семья, здоровье, крупные решения). Мелочь (<4) НЕ пиши вообще.

tasks: только ЯВНОЕ дело, прямо озвученное («купить продукты», «позвонить врачу»). Вопрос «как мне начать бегать?» — НЕ задача. Сомнение → не создавай. Дата по умолчанию — сегодня.

Запоминать нечего → верни {"tasks": [], "memories": []}.`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }
  let raw = content.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Pick<DictationExtraction, 'tasks' | 'memories'>>;
    return { tasks: parsed.tasks ?? [], memories: parsed.memories ?? [] };
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Полный пайплайн: audio (base64) → транскрипт → extraction → запись в БД.
 * Возвращает результат с созданными задачами/memories.
 */
export async function processDictation(
  userId: string,
  audioB64: string,
  format: string,
  durationSeconds?: number,
): Promise<DictationResult> {
  const transcript = await transcribeAudio(audioB64, format);

  if (!transcript || transcript.trim().length < 3) {
    const session = await prisma.dictationSession.create({
      data: {
        userId,
        transcript: transcript || '',
        summary: 'Пустая запись',
        spokenResponse: 'Я ничего не услышал. Попробуй ещё раз?',
        tasksCreated: 0,
        memoriesCreated: 0,
        durationSeconds: durationSeconds ?? null,
      },
    });
    return {
      sessionId: session.id,
      transcript: '',
      summary: 'Пустая запись',
      spokenResponse: 'Я ничего не услышал. Попробуй ещё раз?',
      tasksCreated: [],
      memoriesCreated: [],
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const extracted = await extractFromTranscript(transcript, user?.name || 'друг');

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.dictationSession.create({
      data: {
        userId,
        transcript,
        summary: extracted.summary,
        spokenResponse: extracted.spokenResponse,
        tasksCreated: extracted.tasks.length,
        memoriesCreated: extracted.memories.length,
        durationSeconds: durationSeconds ?? null,
      },
    });

    const createdTasks = await Promise.all(
      extracted.tasks.map((t) =>
        tx.task.create({
          data: {
            userId,
            title: t.title.slice(0, 500),
            category: (t.category || 'personal').slice(0, 32),
            priority: (t.priority || 'medium').slice(0, 32),
            date: new Date(
              (t.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z',
            ),
            time: t.time?.slice(0, 8) ?? null,
            notes: t.notes?.slice(0, 2000) ?? null,
          },
          select: { id: true, title: true, date: true, time: true, category: true },
        }),
      ),
    );

    const createdMemories = await Promise.all(
      extracted.memories.map((m) =>
        tx.memory.create({
          data: {
            userId,
            type: m.type,
            content: m.content.slice(0, 500),
            details: m.details?.slice(0, 2000) ?? null,
            source: 'dictation',
            sourceId: session.id,
            tags: (m.tags || []).slice(0, 10).map((t) => t.slice(0, 32)),
            importance: m.importance ?? 5,
          },
          select: { id: true, type: true, content: true, importance: true, tags: true },
        }),
      ),
    );

    return { session, createdTasks, createdMemories };
  });

  return {
    sessionId: result.session.id,
    transcript,
    summary: extracted.summary,
    spokenResponse: extracted.spokenResponse,
    tasksCreated: result.createdTasks,
    memoriesCreated: result.createdMemories,
  };
}
