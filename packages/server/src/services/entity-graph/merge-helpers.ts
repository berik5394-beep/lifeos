/**
 * Чистые хелперы склейки сущностей (T1). Без I/O.
 */

function readMaxDist(): number {
  const raw = process.env.ENTITY_MERGE_MAX_COSINE_DIST;
  if (raw === undefined) return 0.12;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.12;
}

/** Порог cosine-distance для merge по эмбеддингу (env ENTITY_MERGE_MAX_COSINE_DIST, дефолт 0.12 ≈ sim 0.88). */
export const MERGE_MAX_COSINE_DIST = readMaxDist();

/** Принять merge по эмбеддингу ТОЛЬКО если дистанция конечна и ≤ порога. */
export function shouldMergeByEmbedding(dist: number, maxDist: number = MERGE_MAX_COSINE_DIST): boolean {
  return Number.isFinite(dist) && dist <= maxDist;
}

/** Нормализовать список алиасов: трим, дроп пустых, case-insensitive дедуп (первая форма), кап кол-ва и длины. */
export function capAliases(aliases: string[], max = 20, maxLen = 255): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    const v = (a ?? '').trim().slice(0, maxLen);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
