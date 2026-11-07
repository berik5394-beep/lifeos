import type { PrismaClient } from '@prisma/client';

// Чистим все public-таблицы между тестами (кроме служебной _prisma_migrations —
// её трогать нельзя, иначе пришлось бы migrate на каждый тест).
//
// DELETE, а НЕ TRUNCATE (флейк 2026-11-07, habit-day в общем прогоне):
// TRUNCATE берёт эксклюзивный замок на каждую таблицу по очереди. Если прошлый
// тест оставил недописанную фоновую запись (`void onHabitDone` → awardCoins →
// INSERT CoinTransaction со ссылкой на User), замок User уже у очистки, замок
// CoinTransaction — у записи, и обе ждут друг друга → Postgres через 1 с
// отменяет очистку с `deadlock detected` (40P01) → красный тест. Под нагрузкой
// фоновые записи медленнее и чаще доживают до следующего теста.
// DELETE берёт обычный замок строк: с чужими записями не конфликтует, просто
// дожидается их строк. Заодно в ~20 раз дешевле (TRUNCATE 60 таблиц ≈ 330 мс
// на тест — почти всё время теста, под нагрузкой >10 с → таймаут хука).
//
// Порядок — родители раньше детей: фоновая вставка ребёнка после удаления
// родителя упрётся в FK и откатится, а не оставит сироту следующему тесту.
// FK-триггеры своей сессии выключаем (session_replication_role = replica,
// только на эту транзакцию), иначе ON DELETE RESTRICT не дал бы удалить
// родителя первым. Роль тест-БД — суперпользователь (локально и в CI).
// Последовательностей в схеме нет (id — cuid), сбрасывать нечего.
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const links = await prisma.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public' AND c.conrelid <> c.confrelid
  `;
  const ordered = parentsFirst(
    tables.map((t) => t.tablename),
    links.map((l) => ({ child: unquote(l.child), parent: unquote(l.parent) })),
  );
  await prisma.$transaction([
    prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    ...ordered.map((t) => prisma.$executeRawUnsafe(`DELETE FROM "public"."${t}"`)),
  ]);
}

// regclass::text даёт "User" в кавычках для имён с заглавными, schema не пишет
// (public в search_path).
function unquote(name: string): string {
  return name.replace(/^"(.*)"$/, '$1');
}

// Топологическая сортировка: таблица идёт после всех, на кого ссылается.
// Циклы (если появятся) не вешают сортировку — остаток дописываем как есть.
function parentsFirst(tables: string[], links: Array<{ child: string; parent: string }>): string[] {
  const known = new Set(tables);
  const parents = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of links) {
    if (known.has(child) && known.has(parent)) parents.get(child)!.add(parent);
  }
  const done = new Set<string>();
  const out: string[] = [];
  let progressed = true;
  while (out.length < tables.length && progressed) {
    progressed = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...parents.get(t)!].every((p) => done.has(p))) {
        done.add(t);
        out.push(t);
        progressed = true;
      }
    }
  }
  for (const t of tables) if (!done.has(t)) out.push(t);
  return out;
}
