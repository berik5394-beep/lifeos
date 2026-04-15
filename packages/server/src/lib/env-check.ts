/**
 * Startup environment validation.
 *
 * Проверяет обязательные переменные окружения ДО старта Fastify.
 * Если любая не установлена — процесс падает с понятным сообщением, а не
 * молча инициализируется с пустыми ключами и падает на первом запросе.
 *
 * Причина: process.env.CLAUDE_API_KEY || '' в 5 файлах — при отсутствии
 * ключа SDK создастся с пустой строкой и первый запрос вернёт невнятный
 * 401 от Anthropic спустя минуту после старта. Лучше умереть сразу.
 */

type EnvRequirement = {
  name: string;
  /** Минимальная длина значения (defense-in-depth от случайного "  ") */
  minLength?: number;
  /** Если true — выводится общий шаблон вместо реального текста в ошибке */
  secret?: boolean;
};

const REQUIRED: EnvRequirement[] = [
  { name: 'DATABASE_URL', minLength: 20 },
  { name: 'JWT_SECRET', minLength: 32, secret: true },
  { name: 'CLAUDE_API_KEY', minLength: 20, secret: true },
  { name: 'ENCRYPTION_KEY', minLength: 64, secret: true }, // 32 bytes hex = 64 chars
];

const OPTIONAL_WITH_WARNING: EnvRequirement[] = [
  // Falls back to free tier but logs a warning if missing on prod
  { name: 'GROQ_API_KEY', minLength: 20, secret: true },
  { name: 'TELEGRAM_BOT_TOKEN', minLength: 20, secret: true },
];

export function checkRequiredEnv(): void {
  const missing: string[] = [];
  const tooShort: string[] = [];

  for (const req of REQUIRED) {
    const val = process.env[req.name];
    if (!val || val.trim() === '') {
      missing.push(req.name);
      continue;
    }
    if (req.minLength && val.length < req.minLength) {
      tooShort.push(`${req.name} (${val.length} chars, min ${req.minLength})`);
    }
  }

  if (missing.length > 0 || tooShort.length > 0) {
    const lines = ['❌ LifeOS server startup check failed:'];
    if (missing.length > 0) {
      lines.push(`  Missing env vars: ${missing.join(', ')}`);
    }
    if (tooShort.length > 0) {
      lines.push(`  Invalid env vars (too short): ${tooShort.join(', ')}`);
    }
    lines.push('');
    lines.push('  Fix: set these in your environment (Railway dashboard, .env, etc.)');
    lines.push('  and restart the server.');

    // process.stderr.write — не полагаемся на logger, который может зависеть
    // от env, которые ещё не проверены.
    process.stderr.write(lines.join('\n') + '\n');
    process.exit(1);
  }

  // Soft warnings for optional-but-recommended vars
  const warnings: string[] = [];
  for (const req of OPTIONAL_WITH_WARNING) {
    const val = process.env[req.name];
    if (!val || val.trim() === '') {
      warnings.push(req.name);
    }
  }
  if (warnings.length > 0 && process.env.NODE_ENV === 'production') {
    process.stderr.write(
      `⚠️  Optional env vars missing (some features disabled): ${warnings.join(', ')}\n`,
    );
  }
}
