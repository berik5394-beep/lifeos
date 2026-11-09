/**
 * Флаги FEATURE_V2_* (46 штук) удалены 2026-11-09: на проде все стояли `all`,
 * «выключенные» ветки были недостижимы — код всегда идёт по включённому пути.
 * Здесь остался только снимок FEATURE_* в лог при старте: если в окружении
 * Railway ещё лежат старые переменные, они просто видны и ни на что не влияют.
 */

/**
 * Состояние всех флагов FEATURE_* одной строкой для лога при старте (чистка
 * мёртвых веток, Berik 2026-11-09): значения не секрет — «all/none/true/false»,
 * а список id показываем только числом, без самих id.
 */
export function featureFlagSnapshot(env: NodeJS.ProcessEnv = process.env): string {
  return Object.keys(env)
    .filter((k) => k.startsWith('FEATURE_'))
    .sort()
    .map((k) => {
      const v = (env[k] ?? '').trim();
      const shown = v === '' || ['all', 'none', 'true', 'false', 'on', 'off'].includes(v.toLowerCase())
        ? v || '(пусто)'
        : `список(${v.split(',').filter((x) => x.trim()).length})`;
      return `${k.replace(/^FEATURE_/, '')}=${shown}`;
    })
    .join(' ');
}
