import type { FastifyInstance } from 'fastify';
import { MODELS } from '../lib/models.js';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { AppError, AiModelError } from '../lib/errors.js';

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

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

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

const captureTaskSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
  hint: z.string().max(500).optional(),
});

const verifyExerciseSchema = z.object({
  image: z.string().min(100, 'Image обязателен (base64)'),
  mediaType: mediaTypeSchema,
  exercise: z.enum(['squats', 'pushups', 'plank', 'burpees', 'jumps', 'lunges', 'situps', 'highknees']),
  challengeId: z.string().optional(),
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

  // ----- Import schedule items as tasks -----------------------------------
  const importScheduleSchema = z.object({
    items: z.array(
      z.object({
        day: z.string().optional().default(''),
        time: z.string().optional().default(''),
        subject: z.string().min(1),
        room: z.string().optional().default(''),
        teacher: z.string().optional().default(''),
        notes: z.string().optional().default(''),
      }),
    ),
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
      const baseDate = dateISO ? new Date(dateISO) : new Date();
      baseDate.setHours(0, 0, 0, 0);

      const result = await prisma.task.createMany({
        data: tasks.map((t) => ({
          userId,
          title: t.title,
          category: t.category,
          priority: t.priority,
          date: baseDate,
          time: t.time || null,
          notes: t.notes || null,
        })),
      });

      return reply.send({ ok: true, created: result.count });
    } catch (err) {
      app.log.error({ err }, 'Save captured tasks error');
      return reply.status(500).send({ message: 'Не удалось сохранить задачи' });
    }
  });

  // ----- Arena exercise verification --------------------------------------
  // Used by battle-screen / challenge flow. User takes a selfie/photo while
  // doing the exercise. Claude Vision verifies the person is actually doing
  // the exercise (form + activity detection). Result is passed to
  // /challenge/complete with `verified: true`.
  app.post('/vision/verify-exercise', {
    bodyLimit: PHOTO_BODY_LIMIT,
    preHandler: [visionRateLimit, aiDailyLimiter, validate(verifyExerciseSchema)],
  }, async (request, reply) => {
    const { image, mediaType, exercise } = request.body as z.infer<typeof verifyExerciseSchema>;
    const userId = request.userId;

    try {
      assertImageSizeOk(image, mediaType);
      const exerciseLabels: Record<string, string> = {
        squats: 'приседания (squat position)',
        pushups: 'отжимания (push-up position, hands on floor)',
        plank: 'планка (plank position, body straight, on elbows or hands)',
        burpees: 'бёрпи (burpee — explosive full-body movement)',
        jumps: 'прыжки (jumping in place)',
        lunges: 'выпады (lunge position, one leg forward)',
        situps: 'упражнения на пресс (sit-up or crunch position)',
        highknees: 'высокие колени (high knees running in place)',
      };

      const expected = exerciseLabels[exercise] || exercise;

      const response = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 512,
        system:
          'You are a fitness verification assistant. Analyze the image and determine if a person is performing the specified exercise. ' +
          'Return ONLY a JSON object with this exact shape:\n' +
          '{"verified": boolean, ' +
          '"confidence": "high"|"medium"|"low", ' +
          '"detectedActivity": string (Russian, what you actually see), ' +
          '"reason": string (Russian, 1 sentence explaining the verdict), ' +
          '"formFeedback": string (Russian, optional tip on form if relevant)}\n' +
          'Mark verified=true only if you clearly see a person in the correct position for the exercise. ' +
          'If the image shows an empty room, an object, or a different activity — mark verified=false. ' +
          'Be strict but fair — partial positions are OK if the intent is clear.',
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
                text: `Подтверди выполнение упражнения: ${expected}. Верни JSON.`,
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

      // Log verification attempt for audit
      app.log.info({ userId, exercise, verified: parsed.verified }, 'Exercise verification');

      return reply.send(parsed);
    } catch (err) {
      if (err instanceof AppError) throw err;
      app.log.error({ err }, 'Vision verify-exercise error');
      return reply.status(500).send({
        message: 'Не удалось проверить упражнение. Попробуй ещё раз.',
      });
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
      const baseDate = dateISO ? new Date(dateISO) : new Date();
      baseDate.setHours(0, 0, 0, 0);

      // BUG FIX: Task model has `notes` and `time`, not `description`/`timeBlock`.
      // Previous version used `as any` + swallowed errors → feature was silently broken.
      const result = await prisma.task.createMany({
        data: items.map((item) => ({
          userId,
          title: item.subject + (item.room ? ` (${item.room})` : ''),
          date: baseDate,
          category: 'education',
          priority: 'medium',
          time: item.time || null,
          notes:
            [item.teacher && `👨‍🏫 ${item.teacher}`, item.notes]
              .filter(Boolean)
              .join(' • ') || null,
        })),
      });

      return reply.send({
        ok: true,
        created: result.count,
        total: items.length,
      });
    } catch (err) {
      app.log.error({ err }, 'Import schedule error');
      return reply.status(500).send({ message: 'Не удалось импортировать расписание' });
    }
  });
}
