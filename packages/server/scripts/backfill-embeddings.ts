/**
 * One-off backfill: считает Voyage embedding для всех Memory rows
 * где embedding IS NULL. Идемпотентен — пропускает уже-filled.
 *
 * Контекст 2026-05-28: inspect-memory.ts показал 42/67 NULL (62%).
 * Гибридный retrieval падает на чистый FTS для 2/3 памяти —
 * semantic boost не работает.
 *
 * Запуск (нужен VOYAGE_API_KEY в env):
 *   cd packages/server
 *   DATABASE_URL='postgresql://...' \
 *     VOYAGE_API_KEY='...' \
 *     npx tsx scripts/backfill-embeddings.ts
 *
 * Или через Railway CLI (подтянет env автоматом):
 *   railway run npx tsx scripts/backfill-embeddings.ts
 *
 * Safety:
 *   - Только UPDATE SET embedding для NULL rows. Никакого DELETE.
 *   - Rate-limit: 200ms между Voyage call'ами (50M токенов free
 *     tier — 42 rows × ~100 токенов = 4200 токенов, копейки).
 *   - При первой ошибке — стоп, не маскируем (видишь что сломалось).
 */
import { PrismaClient } from '@prisma/client';
import {
  embedDocument,
  embeddingsEnabled,
  toVectorLiteral,
} from '../src/services/embeddings.js';

const prisma = new PrismaClient();
const RATE_LIMIT_MS = 200;

async function main(): Promise<void> {
  if (!embeddingsEnabled()) {
    console.error(
      'VOYAGE_API_KEY не задан в env — embeddings disabled. Backfill невозможен.',
    );
    process.exit(1);
  }

  // Получаем rows без embedding
  const rows = await prisma.$queryRaw<
    Array<{ id: string; content: string; details: string | null }>
  >`
    SELECT id, content, details
    FROM "Memory"
    WHERE embedding IS NULL
    ORDER BY "createdAt" ASC;
  `;

  console.log(`Найдено ${rows.length} Memory rows без embedding.`);
  if (rows.length === 0) {
    console.log('Нечего backfill. Выход.');
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const text = r.details ? `${r.content}. ${r.details}` : r.content;
    if (!text || text.trim().length === 0) {
      skipped++;
      console.log(`[${i + 1}/${rows.length}] id=${r.id} skip (empty content)`);
      continue;
    }

    try {
      const vec = await embedDocument(text);
      if (!vec) {
        skipped++;
        console.log(
          `[${i + 1}/${rows.length}] id=${r.id} skip (Voyage returned null)`,
        );
        continue;
      }
      await prisma.$executeRawUnsafe(
        'UPDATE "Memory" SET embedding = $1::vector WHERE id = $2',
        toVectorLiteral(vec),
        r.id,
      );
      ok++;
      console.log(
        `[${i + 1}/${rows.length}] id=${r.id} ok (${vec.length}d, ${text.length} chars)`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[${i + 1}/${rows.length}] id=${r.id} FAILED:`,
        err instanceof Error ? err.message : err,
      );
      // Стоп при первой ошибке — лучше видеть baseline проблему
      console.error('Прерываю backfill при первой ошибке. Разберись и перезапусти.');
      break;
    }

    // Rate-limit (защита от Voyage rate-limits, и так дешёво)
    if (i < rows.length - 1) {
      await new Promise((res) => setTimeout(res, RATE_LIMIT_MS));
    }
  }

  console.log('\n=== Backfill summary ===');
  console.log(`Total candidates: ${rows.length}`);
  console.log(`OK:               ${ok}`);
  console.log(`Skipped (empty):  ${skipped}`);
  console.log(`Failed:           ${failed}`);
  console.log(
    `\nИдемпотентно: повторный запуск пропустит уже-filled rows. ` +
      `Проверь результат: npx tsx scripts/inspect-memory.ts (раздел 3 — fill_pct).`,
  );
}

main()
  .catch((e) => {
    console.error('backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
