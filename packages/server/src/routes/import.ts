import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import multipart from '@fastify/multipart';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

function parseICS(text: string): Array<Record<string, string>> {
  const events: Array<Record<string, string>> = [];
  const blocks = text.split('BEGIN:VEVENT');

  for (let i = 1; i < blocks.length; i++) {
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

  app.post('/import/file', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: 'Файл не предоставлен' });
    }

    const buffer = await file.toBuffer();
    const fileName = file.filename;
    const ext = getFileExtension(fileName);

    let parsedData: unknown[] = [];
    let fileType = ext;

    try {
      switch (ext) {
        case 'xlsx':
        case 'xls':
        case 'csv': {
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const firstSheet = workbook.SheetNames[0];
          parsedData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
          fileType = ext === 'csv' ? 'csv' : 'xlsx';
          break;
        }
        case 'ics': {
          const text = buffer.toString('utf-8');
          parsedData = parseICS(text);
          fileType = 'ics';
          break;
        }
        case 'pdf': {
          parsedData = [{ type: 'pdf', fileName, note: 'PDF содержимое сохранено' }];
          fileType = 'pdf';
          break;
        }
        default:
          return reply
            .status(400)
            .send({ message: `Неподдерживаемый формат файла: .${ext}` });
      }
    } catch {
      return reply.status(400).send({ message: 'Ошибка при разборе файла' });
    }

    const analysis = await analyzeWithClaude(parsedData);

    const imported = await prisma.importedFile.create({
      data: {
        userId: request.userId,
        fileName,
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
      return reply
        .status(404)
        .send({ message: 'Импортированный файл не найден' });
    }

    await prisma.importedFile.delete({ where: { id } });
    return reply.send({ success: true });
  });
}
