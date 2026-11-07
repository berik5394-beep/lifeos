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

/** Прежние значения атрибутов: «раньше жила в Алматы». `_` — служебный, в факты не идёт. */
export const ATTR_HISTORY_KEY = '_history';
const HISTORY_MAX = 20;
export interface AttrHistoryEntry {
  key: string;
  value: unknown;
  /** Когда значение сменилось (ISO). */
  until: string;
}

/** Синонимы ключей (нижний регистр, ё→е): «city» и «город» — один атрибут. */
const KEY_SYNONYMS: Record<string, string> = {
  city: 'город',
  'город проживания': 'город',
  'место жительства': 'город',
  живет: 'город',
  job: 'работа',
  work: 'работа',
  'место работы': 'работа',
  profession: 'профессия',
  phone: 'телефон',
  'номер телефона': 'телефон',
};

/** Канонический вид ключа для сравнения (сам ключ в данных не переименовываем). */
export function canonicalAttrKey(k: string): string {
  const n = k.trim().toLowerCase().replace(/ё/g, 'е');
  return KEY_SYNONYMS[n] ?? n;
}

function isEmptyVal(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function sameVal(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е');
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge атрибутов сущности (T5).
 *  - deliberate=true (инструмент): incoming-wins.
 *  - deliberate=false (фоновая экстракция): не затирать непустое существующее;
 *    заполнять пустые; добавлять новые. → «брат» не сменится «знакомым».
 *  - changedKeys: ключи, о которых пользователь ПРЯМО сказал «изменилось»
 *    («мама переехала в Астану») — для них фон тоже заменяет значение.
 * Заменённое значение не теряется — уходит в `_history`. Ключи сравниваются
 * по смыслу (city = город), запись идёт в уже существующий ключ.
 */
export function mergeAttributes(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  deliberate: boolean,
  changedKeys: string[] = [],
  now: Date = new Date(),
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  const changed = new Set(changedKeys.map(canonicalAttrKey));
  const prev = Array.isArray(existing[ATTR_HISTORY_KEY]) ? (existing[ATTR_HISTORY_KEY] as AttrHistoryEntry[]) : [];
  const history = [...prev];
  for (const [k, v] of Object.entries(incoming)) {
    if (k.startsWith('_')) {
      // Служебные ключи — как раньше, без истории.
      if (deliberate || isEmptyVal(out[k])) out[k] = v;
      continue;
    }
    const ck = canonicalAttrKey(k);
    const target = Object.keys(out).find((ek) => !ek.startsWith('_') && canonicalAttrKey(ek) === ck) ?? k;
    const cur = out[target];
    if (isEmptyVal(cur)) {
      out[target] = v;
      continue;
    }
    if (isEmptyVal(v) || sameVal(cur, v)) continue;
    if (deliberate || changed.has(ck)) {
      history.push({ key: target, value: cur, until: now.toISOString() });
      out[target] = v;
    }
  }
  if (history.length > prev.length) out[ATTR_HISTORY_KEY] = history.slice(-HISTORY_MAX);
  return out;
}

/** Последнее прежнее значение каждого атрибута — для «раньше …» в фактах. */
export function attrHistoryFacts(attributes: unknown, max = 2): string[] {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
  const h = (attributes as Record<string, unknown>)[ATTR_HISTORY_KEY];
  if (!Array.isArray(h)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...(h as AttrHistoryEntry[])].reverse()) {
    if (!e || typeof e.key !== 'string' || seen.has(e.key)) continue;
    if (typeof e.value !== 'string' && typeof e.value !== 'number') continue;
    const val = String(e.value).trim();
    if (!val || val.length > 60) continue;
    seen.add(e.key);
    out.push(`раньше ${e.key}: ${val}`);
    if (out.length >= max) break;
  }
  return out;
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

// ---------------------------------------------------------------------------
// Родственники без имени: «Старший брат» ≠ «Младший брат»
// ---------------------------------------------------------------------------

/** Слова родства (нижний регистр, ё→е). */
const KIN_NOUNS = new Set([
  'брат', 'братишка', 'сестра', 'сестренка', 'мама', 'мать', 'папа', 'отец', 'сын', 'дочь', 'дочка',
  'бабушка', 'дедушка', 'дед', 'баба', 'дядя', 'тетя', 'муж', 'жена', 'племянник', 'племянница',
  'внук', 'внучка', 'тесть', 'теща', 'свекор', 'свекровь', 'зять', 'невестка', 'кузен', 'кузина',
  'отчим', 'мачеха', 'аке', 'апа', 'ага', 'әке', 'ана',
]);
/** Различители родства — по основе (старший/старшая/старшего → «старш»). */
const KIN_QUALIFIERS = ['старш', 'младш', 'средн', 'двоюрод', 'троюрод', 'сводн', 'родн', 'перв', 'втор', 'трет', 'больш', 'маленьк'];

function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-яәіңғүұқөһ0-9]+/i).filter(Boolean);
}
function qualifierOf(w: string): string | null {
  return KIN_QUALIFIERS.find((q) => w.startsWith(q)) ?? null;
}

/** Имя — только родство (+ различитель): «Брат», «Старший брат», «Двоюродная сестра». */
export function isKinOnlyName(name: string): boolean {
  const ws = nameWords(name);
  return ws.length > 0 && ws.some((w) => KIN_NOUNS.has(w)) && ws.every((w) => KIN_NOUNS.has(w) || qualifierOf(w) !== null || w === 'мой' || w === 'моя');
}

/**
 * Два имени — заведомо РАЗНЫЕ родственники, даже если похожи по смыслу
 * (эмбеддинг «Старший брат» ≈ «Младший брат», «Брат Ерлан» ≈ «Брат Данияр»):
 *  - разное родство (брат / сестра);
 *  - оба с различителем, и различители разные (старший / младший);
 *  - одно родство, но у каждого своё имя (Ерлан / Данияр).
 * Склейку по эмбеддингу в таких случаях не делаем.
 */
export function kinConflict(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  const kinA = new Set(wa.filter((w) => KIN_NOUNS.has(w)));
  const kinB = new Set(wb.filter((w) => KIN_NOUNS.has(w)));
  if (kinA.size === 0 || kinB.size === 0) return false; // не про родню — решает эмбеддинг
  const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((v) => y.has(v));
  if (!same(kinA, kinB)) return true;
  const qa = new Set(wa.map(qualifierOf).filter((q): q is string => q !== null));
  const qb = new Set(wb.map(qualifierOf).filter((q): q is string => q !== null));
  if (qa.size > 0 && qb.size > 0 && !same(qa, qb)) return true;
  const rest = (ws: string[]) => new Set(ws.filter((w) => !KIN_NOUNS.has(w) && qualifierOf(w) === null && w !== 'мой' && w !== 'моя'));
  const ra = rest(wa);
  const rb = rest(wb);
  const onlyA = [...ra].some((w) => !rb.has(w));
  const onlyB = [...rb].some((w) => !ra.has(w));
  return onlyA && onlyB;
}
