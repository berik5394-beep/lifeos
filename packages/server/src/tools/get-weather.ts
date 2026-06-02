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
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { location: 'city', place: 'city', town: 'city' },
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
    const city = input.city || 'Алматы';
    // SSOT P0 mock-labels: getWeather теперь честно падает (не отдаёт
    // 0°C / чужой город как настоящие). Ловим → честный текст агенту,
    // а не сырое «Ошибка инструмента» и не выдуманная погода.
    try {
      const w = await getWeather(city);
      return {
        city: w.cityName,
        temp: w.temp,
        feelsLike: w.feelsLike,
        description: w.description,
        wind: w.wind,
        forecast: w.forecast,
      };
    } catch {
      return {
        error: `Не смог получить погоду для «${city}» — сервис погоды сейчас недоступен. Скажи об этом честно, не придумывай прогноз.`,
      };
    }
  },
});
