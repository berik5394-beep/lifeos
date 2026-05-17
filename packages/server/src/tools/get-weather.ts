import { z } from 'zod';
import { getWeather } from '../services/external-apis.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 3 — read-only. Тонкая обёртка над чистым external-apis
 * (Open-Meteo) — НЕ зависит от legacy action-executor switch
 * (его сносят на Шаге 9). Дублирования логики нет: вся погода
 * по-прежнему в одном месте (external-apis.getWeather).
 */
export const getWeatherTool = defineTool({
  name: 'get_weather',
  description:
    'Погода и прогноз на 3 дня в городе (по умолчанию Алматы). ' +
    'Вызывай на «какая погода», «что надеть», «во сколько выезжать» ' +
    '— особенно если у юзера сегодня встреча/поездка.',
  category: 'info',
  schema: z.object({
    city: z
      .string()
      .max(80)
      .optional()
      .describe('город (опц., по умолчанию Алматы)'),
  }),
  needsConfirm: false,
  sideEffects: 'external',
  examples: ['какая погода', 'что надеть завтра', 'погода в Астане'],
  handler: async (input) => {
    const w = await getWeather(input.city || 'Алматы');
    return {
      city: w.cityName,
      temp: w.temp,
      feelsLike: w.feelsLike,
      description: w.description,
      wind: w.wind,
      forecast: w.forecast,
    };
  },
});
