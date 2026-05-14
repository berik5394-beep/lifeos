import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import multipart from '@fastify/multipart';
import ExcelJS from 'exceljs';
import Anthropic from '@anthropic-ai/sdk';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { AppError, NotFoundError, ValidationError } from '../lib/errors.js';

// Import calls Claude API + parses files — tight cap per IP
const importRateLimit = rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'import' });

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

// Security limits
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS_PARSED = 5000; // hard cap on rows we'll process

// Allowed MIME types for each extension (validated against magic bytes too)
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'csv', 'ics', 'pdf']);

/**
 * Magic-byte sniff. Returns the inferred extension or null if unrecognized.
 * Prevents extension spoofing (e.g. a malicious script renamed .xlsx).
 */
function sniffFileType(buffer: Buffer): 'xlsx' | 'csv-or-ics' | 'pdf' | 'unknown' {
  if (buffer.length < 4) return 'unknown';
  // xlsx/xls are ZIP files: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'xlsx';
  }
  // PDF: %PDF-
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }
  // Plain text — used by CSV and ICS. Rough check: first 256 bytes are printable.
  const head = buffer.slice(0, 256).toString('utf-8');
  const printableRatio =
    head.replace(/[^\x20-\x7E\r\n\t\u0400-\u04FF]/g, '').length / head.length;
  if (printableRatio > 0.9) return 'csv-or-ics';
  return 'unknown';
}

function parseICS(text: string): Array<Record<string, string>> {
  const events: Array<Record<string, string>> = [];
  const blocks = text.split('BEGIN:VEVENT');

  for (let i = 1; i < blocks.length && events.length < MAX_ROWS_PARSED; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    const event: Record<string, string> = {};

    const summaryMatch = block.match(/SUMMARY[^:]*:(.*)/);
    if (summaryMatch) event.summary = summaryMatch[1].trim();

    const dtstartMatch = block.match(/DTSTART[^:]*:(.*)/);
    if (dtstartMatch) event.dtstart = dtstartMatch[1].trim();

    const dtendMatch = block.match(/DTEND[^:]*:(.*)/);
    if (dtendMatch) event.dtend = dtendMatch[1].trim();

    const locationMatch = block.match(/LOCATION[^:]*:(.*)/);
    if (locationMatch) event.location = locationMatch[1].trim();

    if (Object.keys(event).length > 0) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Minimal, safe CSV parser. Handles RFC 4180 basics: quoted fields, embedded
 * commas, escaped quotes ("") inside quotes. No prototype access — rows become
 * plain objects via `Object.create(null)` internally.
 */
function parseCSV(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length && rows.length < MAX_ROWS_PARSED + 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = Object.create(null);
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j] || `col${j}`] = r[j] ?? '';
    }
    return obj;
  });
}

/**
 * Parse xlsx via exceljs (replaces SheetJS due to prototype-pollution CVEs).
 * Only reads first sheet, caps rows.
 */
async function parseXLSX(buffer: Buffer): Promise<Array<Record<string, unknown>>> {
  const workbook = new ExcelJS.Workbook();
  // Cast to any to avoid ExcelJS's overly specific Buffer type narrowing
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: Array<Record<string, unknown>> = [];
  let headers: string[] = [];
  sheet.eachRow((row, rowIdx) => {
    if (rows.length >= MAX_ROWS_PARSED) return;
    const values = (row.values as unknown[]).slice(1); // exceljs uses 1-based arrays
    if (rowIdx === 1) {
      headers = values.map((v, i) => String(v ?? `col${i}`).trim());
      return;
    }
    const obj: Record<string, unknown> = Object.create(null);
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = values[i] ?? '';
    }
    rows.push(obj);
  });
  return rows;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

async function analyzeWithClaude(
  parsedData: unknown[],
): Promise<{ purpose: string; items: unknown[] }> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system:
        'Analyze this parsed data and determine what it contains. Return JSON: { purpose: "meetings"|"expenses"|"tasks"|"habits", items: [...] }. Each item should have fields appropriate for its type.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(parsedData.slice(0, 50)),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { purpose: 'unknown', items: parsedData };
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { purpose: 'unknown', items: parsedData };
    }

    return JSON.parse(jsonMatch[0]) as { purpose: string; items: unknown[] };
  } catch {
    return { purpose: 'unknown', items: parsedData };
  }
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  app.addHook('preHandler', authMiddleware);

  // --- Upload and parse file ---

  app.post('/import/file', {
    bodyLimit: MAX_FILE_BYTES + 1024 * 1024,
    preHandler: [importRateLimit, aiDailyLimiter],
  }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new ValidationError('Файл не предоставлен');
    }

    // Sanitize filename to prevent path traversal (we only use it for display/metadata)
    const safeName = (file.filename || 'upload')
      .replace(/[/\\]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 200);

    const ext = getFileExtension(safeName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ValidationError(`Неподдерживаемый формат файла: .${ext}`, {
        allowed: Array.from(ALLOWED_EXTENSIONS),
      });
    }

    const buffer = await file.toBuffer();

    if (buffer.length > MAX_FILE_BYTES) {
      // 413 Payload Too Large — отдельный код, чтобы клиент мог показать
      // специфичный UI (прогресс → "файл слишком большой, сожми"), а не
      // общий валидационный тост.
      throw new AppError({
        code: 'PAYLOAD_TOO_LARGE',
        statusCode: 413,
        userMessage: 'Файл слишком большой. Максимум 10 МБ.',
      });
    }
    if (buffer.length === 0) {
      throw new ValidationError('Файл пуст');
    }

    // Magic-byte check: prevents extension spoofing + unknown file types
    const sniffed = sniffFileType(buffer);
    const extToSniff: Record<string, string[]> = {
      xlsx: ['xlsx'],
      xls: ['xlsx'],
      csv: ['csv-or-ics'],
      ics: ['csv-or-ics'],
      pdf: ['pdf'],
    };
    if (!extToSniff[ext]?.includes(sniffed)) {
      throw new ValidationError('Содержимое файла не соответствует его расширению', {
        declaredExt: ext,
        sniffed,
      });
    }

    let parsedData: unknown[] = [];
    let fileType = ext;

    try {
      switch (ext) {
        case 'xlsx':
        case 'xls': {
          parsedData = await parseXLSX(buffer);
          fileType = 'xlsx';
          break;
        }
        case 'csv': {
          parsedData = parseCSV(buffer.toString('utf-8'));
          fileType = 'csv';
          break;
        }
        case 'ics': {
          parsedData = parseICS(buffer.toString('utf-8'));
          fileType = 'ics';
          break;
        }
        case 'pdf': {
          parsedData = [{ type: 'pdf', fileName: safeName, note: 'PDF содержимое сохранено' }];
          fileType = 'pdf';
          break;
        }
      }
    } catch (err) {
      // Логируем причину, но пользователю отдаём типизированную ValidationError
      // — глобальный handler нормализует ответ. cause сохраняется для трейса.
      app.log.warn({ err, ext }, 'Import parse failed');
      throw new ValidationError('Не удалось разобрать файл', {
        ext,
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const analysis = await analyzeWithClaude(parsedData);

    const imported = await prisma.importedFile.create({
      data: {
        userId: request.userId,
        fileName: safeName,
        fileType,
        purpose: analysis.purpose,
        parsedData: analysis.items as unknown as Prisma.InputJsonValue,
      },
    });

    return reply.status(201).send({
      id: imported.id,
      fileName: imported.fileName,
      fileType: imported.fileType,
      purpose: analysis.purpose,
      itemCount: analysis.items.length,
      items: analysis.items.slice(0, 10),
    });
  });

  // --- Import history ---

  app.get('/import/history', async (request) => {
    return prisma.importedFile.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  // --- Delete imported file ---

  app.delete('/import/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const file = await prisma.importedFile.findFirst({
      where: { id, userId: request.userId },
    });
    if (!file) {
      throw new NotFoundError('Импортированный файл');
    }

    await prisma.importedFile.delete({ where: { id } });
    return reply.send({ success: true });
  });
}
