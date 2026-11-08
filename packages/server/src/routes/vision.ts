import type { FastifyInstance } from 'fastify';
import { MODELS } from '../lib/models.js';
import { z } from 'zod';
import { createAnthropic } from '../lib/anthropic.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { AppError, AiModelError } from '../lib/errors.js';
import { analyzeFinancePhoto, buildFinancePending } from '../services/finance-vision.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { afterBulkTasksCreated, dayForWeekday, startTimeOf } from '../services/bulk-tasks.js';
import { getUserTimezone } from '../lib/user-context.js';
import { civilDayRefs, dateOnlyUTC, localDateOnlyUTC } from '../lib/tz.js';
import { setPendingAction } from '../services/pending-actions.js';

/** День задач из фото: присланный телефоном или «сегодня» по календарю юзера (не UTC сервера). */
async function captureDay(userId: string, dateISO?: string): Promise<Date> {
  // dateOnlyUTC — не зависит от пояса сервера (setHours сдвигал бы день при TZ≠UTC).
  if (dateISO && /^\d{4}-\d{2}-\d{2}/.test(dateISO)) return dateOnlyUTC(dateISO.slice(0, 10));
  return dateOnlyUTC(civilDayRefs(await getUserTimezone(userId)).today);
}

function titlesPreview(titles: string[]): string {
  const head = titles.slice(0, 3).map((t) => `«${t}»`).join(', ');
  return titles.length > 3 ? `${head} и ещё ${titles.length - 3}` : head;
}

// Vision endpoints hit Claude Vision API (expensive per call) — tight cap
const visionRateLimit = rateLimiter({ max: 15, windowMs: 60_000, keyPrefix: 'vision' });

// Anthropic Vision API hard-caps single image at 5MB of decoded binary.
// We enforce this BEFORE shipping the base64 string to Claude so an attacker
// can't OOM our 512MB Railway instance by sending a 10MB base64 blob that
// decodes to ~7.5MB. bodyLimit (15MB on JSON) is a coarse outer guard; this
// is the precise per-image check.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validates a base64-encoded image payload.
 * - Confirms the string is valid base64
 * - Confirms the decoded binary is within MAX_IMAGE_BYTES
 * Throws AppError(PAYLOAD_TOO_LARGE / INVALID_INPUT) on failure.
 *
 * Note: we estimate size via string length first (cheap — no alloc) and
 * only decode a small prefix to verify it's actually base64. Full decode
 * happens inside Anthropic SDK after the size check passes.
 */
function assertImageSizeOk(base64: string, mediaType: string): void {
  // Strip any accidental data-URI prefix the client forgot to remove.
  const commaIdx = base64.indexOf(',');
  const payload = commaIdx > -1 && base64.slice(0, commaIdx).includes('base64') ? base64.slice(commaIdx + 1) : base64;

  // base64 length → decoded bytes ratio: 4 chars = 3 bytes. Account for
  // `=` padding (1–2 chars). Using `length * 3/4` is a tight upper bound.
  const paddingCount = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((payload.length * 3) / 4) - paddingCount;

  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new AppError({
      code: 'PAYLOAD_TOO_LARGE',
      statusCode: 413,
      userMessage: `Фото слишком большое. Максимум ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} МБ.`,
      internalMessage: `Image payload ${estimatedBytes} bytes exceeds ${MAX_IMAGE_BYTES} cap (mediaType=${mediaType})`,
    });
  }

  // Cheap sanity: reject if the string contains characters outside base64 alphabet.
  // Using a bounded regex (not backtracking-prone) on first 256 chars.
  const sample = payload.slice(0, 256);
  if (!/^[A-Za-z0-9+/=_-]*$/.test(sample)) {
    throw new AppError({
      code: 'INVALID_INPUT',
      statusCode: 400,
      userMessage: 'Некорректный формат изображения',
      internalMessage: 'Base64 string contains non-base64 characters',
    });
  }
}

const anthropic = createAnthropic();

const VISION_MODEL = MODELS.sonnet;

// ============================================================================
// Schemas
// ============================================================================

// Whitelist of media types Anthropic's vision model accepts.
// Using an enum (not a free-form string) blocks injection of unexpected
// values that would be passed through `as any` to the SDK.
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];
const mediaTypeSchema = z.enum(SUPPORTED_MEDIA_TYPES).default('image/jpeg');

const analyzeScheduleSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
});

const analyzeFinanceSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
});

const captureTaskSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
  hint: z.string().max(500).optional(),
});

// ============================================================================
// Helpers
// ============================================================================

function extractJSON(text: string): any {
  // Claude sometimes wraps JSON in ```json ... ``` or adds commentary.
  // Любая ошибка парсинга → AiModelError, чтобы глобальный handler отдал 502
  // с понятным текстом, а не 500 "Internal error" (Claude иногда возвращает
  // кривой JSON с обрезанной скобкой или лишним текстом).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenceMatch ? fenceMatch[1] : text;
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new AiModelError(new Error('No JSON object found in model output'));
  }
  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  } catch (parseErr) {
    throw new AiModelError(parseErr);
  }
}

// ============================================================================
// Routes
// ============================================================================

// ============================================================================
// Per-route bodyLimit для эндпоинтов с фото — переопределяет глобальный 256 KB
// ============================================================================
const PHOTO_BODY_LIMIT = 15 * 1024 * 1024; // 15 MB

export async function visionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ----- Analyze schedule/timetable photo → structured lessons ------------
  app.post('/vision/analyze-schedule', {
    bodyLimit: PHOTO_BODY_LIMIT,
    preHandler: [visionRateLimit, aiDailyLimiter, validate(analyzeScheduleSchema)],
  }, async (request, reply) => {
    const { image, mediaType } = request.body as z.infer<typeof analyzeScheduleSchema>;

    try {
      assertImageSizeOk(image, mediaType);
      const response = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 2048,
        system:
          'You extract a schedule/timetable (школьное расписание, план уроков, календарь занятий) ' +
          'from an image. Return ONLY a JSON object with this exact shape:\n' +
          '{"title": string (Russian), "items": [{"day": string (Russian, e.g. "Понедельник" or "" if single-day), ' +
          '"time": string (e.g. "09:00" or ""), "subject": string (Russian), "room": string (optional), ' +
          '"teacher": string (optional), "notes": string (optional)}]}\n' +
          'Extract ALL visible lessons. If the image is a single-day plan, use "" for day. ' +
          'If no schedule is visible, return items: [].',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType as SupportedMediaType,
                  data: image,
                },
              },
              {
                type: 'text',
                text: 'Распознай план/расписание на фото и верни JSON со списком занятий.',
              },
            ],
          },
        ],
      });

      const textBlock = response.content.find((c) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return reply.status(500).send({ message: 'Нет ответа от Claude Vision' });
      }

      const parsed = extractJSON(textBlock.text);
      return reply.send(parsed);
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      app.log.error({ err }, 'Vision analyze-schedule error');
      return reply.status(500).send({
        message: 'Не удалось распознать расписание. Попробуй другое фото.',
      });
    }
  });

  // ----- Analyze receipt / bank-screenshot → expense|income proposal -------
  app.post('/vision/analyze-finance', {
    bodyLimit: PHOTO_BODY_LIMIT,
    preHandler: [visionRateLimit, aiDailyLimiter, validate(analyzeFinanceSchema)],
  }, async (request, reply) => {
    const { image, mediaType } = request.body as { image: string; mediaType: typeof SUPPORTED_MEDIA_TYPES[number] };
    // Размер — до вызова модели (как у остальных фото-роутов; здесь проверки не было).
    assertImageSizeOk(image, mediaType);
    try {
      const userId = request.userId;
      const result = await analyzeFinancePhoto(image, mediaType);
      const tz = await getUserTimezone(userId);
      const built = buildFinancePending(result, localDateOnlyUTC(tz));
      if (!built) {
        return reply.send({
          result,
          pending: null,
          confirmationText: null,
          message: 'Не разобрал сумму на фото. Сфоткай чек ровнее, при свете — или скажи сумму: «3500 на еду».',
        });
      }
      // Тот же чек дважды → честно спросим (одинаковая сумма в тот же день и тот же магазин/категория).
      let text = built.confirmationText;
      if (built.action === 'add_expense') {
        const day = typeof built.input.date === 'string' ? dateOnlyUTC(built.input.date) : localDateOnlyUTC(tz);
        const dup = await prisma.expense.findFirst({
          where: {
            userId,
            date: day,
            amount: Number(built.input.amount),
            OR: [
              { category: String(built.input.category) },
              ...(built.input.description ? [{ description: String(built.input.description) }] : []),
            ],
          },
          select: { id: true },
        });
        if (dup) text = `Похоже, эта трата уже записана. ${text.replace('Записать трату?', 'Всё равно записать?')}`;
      }
      // ЗАПИСЬ — только на «да»: тот же путь подтверждения, что у трат голосом/текстом
      // (pending → runConfirmedAction → add_expense с лимитами, целями, памятью).
      // Раньше ответ говорил «Ответь «да»», а pending не ставился — «да» уходило в пустоту.
      await setPendingAction(userId, built.action, built.input, text);
      // Вопрос — и в историю чата: «да» голосом/текстом придёт мозгу с контекстом,
      // после перезапуска кнопки восстановятся по этому тексту.
      await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: text } }).catch(() => {});
      return reply.send({ result, pending: { action: built.action, input: built.input }, confirmationText: text });
    } catch (err) {
      app.log.error({ err }, 'Vision analyze-finance error');
      return reply.status(500).send({ message: 'Ошибка чтения фото' });
    }
  });

  // ----- Import schedule items as tasks -----------------------------------
  const importScheduleSchema = z.object({
    // Предел: недельное расписание ≤ ~60 пар; без него — неограниченная запись.
    items: z.array(
      z.object({
        day: z.string().max(40).optional().default(''),
        time: z.string().max(40).optional().default(''),
        subject: z.string().min(1).max(200),
        room: z.string().max(100).optional().default(''),
        teacher: z.string().max(100).optional().default(''),
        notes: z.string().max(500).optional().default(''),
      }),
    ).max(100),
    dateISO: z.string().optional(), // yyyy-mm-dd — if provided, creates tasks for that date
  });

  // ----- Smart task capture: photo → suggested tasks ---------------------
  // Use cases: sticky notes, whiteboards, handwritten notes, product receipts,
  // lists from friends, screenshots of plans. User snaps a photo, Claude Vision
  // extracts structured tasks, returns them for preview before saving.
  app.post('/vision/capture-task', {
    bodyLimit: PHOTO_BODY_LIMIT,
    preHandler: [visionRateLimit, aiDailyLimiter, validate(captureTaskSchema)],
  }, async (request, reply) => {
    const { image, mediaType, hint } = request.body as z.infer<typeof captureTaskSchema>;

    try {
      assertImageSizeOk(image, mediaType);
      const response = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 1500,
        system:
          'You are a productivity assistant extracting actionable tasks from a photo. ' +
          'Return ONLY a JSON object with this exact shape:\n' +
          '{"summary": string (Russian, 1 sentence describing what you see), ' +
          '"tasks": [{"title": string (Russian, imperative form, max 80 chars), ' +
          '"category": "work"|"personal"|"health"|"finance"|"education"|"home", ' +
          '"priority": "low"|"medium"|"high"|"critical", ' +
          '"time": string (HH:MM, optional), ' +
          '"notes": string (Russian, optional), ' +
          '"confidence": "high"|"medium"|"low"}]}\n' +
          'Extract every distinct actionable item. ' +
          'If the image shows a handwritten note, receipt, sticky, whiteboard, chat screenshot, document, or list — parse it into tasks. ' +
          'If the image shows something non-actionable, return tasks: []. ' +
          'Choose sensible categories and priorities based on context. ' +
          'For ambiguous time references like "завтра утром" leave time empty but put it in notes.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType as SupportedMediaType,
                  data: image,
                },
              },
              {
                type: 'text',
                text: hint
                  ? `Извлеки задачи из фото. Подсказка от пользователя: "${hint}"`
                  : 'Извлеки задачи из фото и верни JSON.',
              },
            ],
          },
        ],
      });

      const textBlock = response.content.find((c) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return reply.status(500).send({ message: 'Нет ответа от Claude Vision' });
      }

      const parsed = extractJSON(textBlock.text);
      return reply.send(parsed);
    } catch (err) {
      if (err instanceof AppError) throw err;
      app.log.error({ err }, 'Vision capture-task error');
      return reply.status(500).send({
        message: 'Не удалось распознать задачи на фото. Попробуй другое изображение.',
      });
    }
  });

  // ----- Save captured tasks to DB ----------------------------------------
  const saveTasksSchema = z.object({
    tasks: z.array(
      z.object({
        title: z.string().min(1).max(200),
        category: z.string().max(32).optional().default('personal'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
        time: z.string().max(8).optional(),
        notes: z.string().max(500).optional(),
      }),
    ).min(1).max(50),
    dateISO: z.string().optional(),
  });

  app.post('/vision/save-captured-tasks', {
    preHandler: validate(saveTasksSchema),
  }, async (request, reply) => {
    const { tasks, dateISO } = request.body as z.infer<typeof saveTasksSchema>;
    const userId = request.userId;

    try {
      const baseDate = await captureDay(userId, dateISO);

      const created = await prisma.task.createManyAndReturn({
        data: tasks.map((t) => ({
          userId,
          title: t.title,
          category: t.category,
          priority: t.priority,
          date: baseDate,
          time: (t.time && startTimeOf(t.time)) || null,
          notes: t.notes || null,
        })),
        select: { id: true, title: true, date: true, time: true },
      });

      if (created.length > 0) {
        captureActivity(userId, {
          type: 'tasks_captured',
          content: `Снял задачи с фото (${created.length}): ${titlesPreview(tasks.map((t) => t.title))}`,
        });
      }
      // Как у задач с экрана: привязка к цели, наложение, перегруз дня.
      const checks = await afterBulkTasksCreated(userId, created);
      return reply.send({ ok: true, created: created.length, ...checks });
    } catch (err) {
      app.log.error({ err }, 'Save captured tasks error');
      return reply.status(500).send({ message: 'Не удалось сохранить задачи' });
    }
  });

  app.post('/vision/import-schedule', {
    preHandler: validate(importScheduleSchema),
  }, async (request, reply) => {
    const { items, dateISO } = request.body as z.infer<typeof importScheduleSchema>;
    const userId = request.userId;

    if (items.length === 0) {
      return reply.send({ ok: true, created: 0, total: 0 });
    }

    try {
      const baseDate = await captureDay(userId, dateISO);

      // BUG FIX: Task model has `notes` and `time`, not `description`/`timeBlock`.
      // Previous version used `as any` + swallowed errors → feature was silently broken.
      // День недели из фото («Понедельник») → ближайшая такая дата (раньше day
      // игнорировался и вся неделя ложилась на один день); «9:00–10:30» → «09:00».
      const baseDay = baseDate.toISOString().slice(0, 10);
      const created = await prisma.task.createManyAndReturn({
        data: items.map((item) => ({
          userId,
          title: item.subject + (item.room ? ` (${item.room})` : ''),
          date: new Date(`${dayForWeekday(item.day, baseDay)}T00:00:00Z`),
          category: 'education',
          priority: 'medium',
          time: startTimeOf(item.time),
          notes:
            [item.teacher && `👨‍🏫 ${item.teacher}`, item.notes]
              .filter(Boolean)
              .join(' • ') || null,
        })),
        select: { id: true, title: true, date: true, time: true },
      });

      if (created.length > 0) {
        captureActivity(userId, {
          type: 'schedule_imported',
          content: `Загрузил расписание (${created.length} пар): ${titlesPreview(items.map((i) => i.subject))}`,
        });
      }
      const checks = await afterBulkTasksCreated(userId, created);
      return reply.send({
        ok: true,
        created: created.length,
        total: items.length,
        ...checks,
      });
    } catch (err) {
      app.log.error({ err }, 'Import schedule error');
      return reply.status(500).send({ message: 'Не удалось импортировать расписание' });
    }
  });
}
