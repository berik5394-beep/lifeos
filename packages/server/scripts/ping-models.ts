/**
 * Quick model-ping script — проверяет какие model IDs реально
 * доступны в текущем Anthropic API key (твой аккаунт, твой tier).
 *
 * Запуск:
 *   cd packages/server
 *   CLAUDE_API_KEY='sk-ant-...' npx tsx scripts/ping-models.ts
 *
 * Berik: ключ возьми из Railway → lifeos-api → Variables →
 * CLAUDE_API_KEY (👁 → 📋). Мне его НЕ присылай.
 *
 * Что ответит:
 *   - OK для каждой модели = можно использовать
 *   - 404 = модель не существует / нет доступа
 *   - 401/403 = ключ неправильный
 *   - другое = редкая ошибка, читай message
 */
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error('CLAUDE_API_KEY не задан в env. Запусти с env переменной.');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

// Имена которые сейчас в нашем lib/models.ts + альтернативы
const MODELS_TO_TEST = [
  // Aliases (dateless, должны работать в 4.6+ generation)
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  // Full snapshot IDs (на случай если alias не работает)
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
  // Старые имена которые были hardcoded раньше
  'claude-sonnet-4-20250514',
  'claude-haiku-4-20250514',
];

async function ping(model: string): Promise<void> {
  process.stdout.write(`[${model}]: `);
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 5,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const text = resp.content.find((b) => b.type === 'text');
    const reply =
      text && text.type === 'text' ? text.text.slice(0, 30) : '<no text>';
    console.log(`OK (reply: "${reply}")`);
  } catch (err) {
    if (err instanceof Error) {
      const msg = err.message.slice(0, 200);
      console.log(`FAIL: ${msg}`);
    } else {
      console.log(`FAIL: ${String(err).slice(0, 200)}`);
    }
  }
}

(async () => {
  console.log('=== Anthropic model availability check ===\n');
  for (const m of MODELS_TO_TEST) {
    await ping(m);
    await new Promise((r) => setTimeout(r, 300)); // anti rate-limit
  }
  console.log('\n=== Done ===');
})();
