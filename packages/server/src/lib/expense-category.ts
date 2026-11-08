/**
 * Категория расхода → канонический ключ, по которому считают графики и
 * лимиты (REST /finance принимает только их). Мозг и ответ на вопрос «на что?»
 * присылают свободный текст («еда», «бензин», «компьютер») — раньше он
 * попадал в БД как есть, и график такой расход не видел.
 */
/**
 * ЕДИНЫЙ список с приложением (apps/mobile/constants/categories.ts). Раньше тут
 * был 'home', а приложение показывает/шлёт 'housing' и 'education' — REST их
 * отвергал (400), а траты робота «за квартиру» не попадали в таблицу.
 * Старое 'home' принимаем и превращаем в 'housing' (миграция перевела записи).
 */
export const EXPENSE_CATEGORIES = ['food', 'transport', 'entertainment', 'clothing', 'health', 'education', 'housing', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** По-русски — как в приложении. 'home' — старый ключ (= Жильё). */
export const EXPENSE_LABELS: Record<string, string> = {
  food: 'Еда', transport: 'Транспорт', entertainment: 'Развлечения', clothing: 'Одежда', health: 'Здоровье',
  education: 'Образование', housing: 'Жильё', home: 'Жильё', other: 'Другое',
};

/** Основы слов (нижний регистр, ё→е). Проверяются как начало любого слова. */
const STEMS: Record<Exclude<ExpenseCategory, 'other'>, string[]> = {
  food: [
    'еда', 'еду', 'еды', 'продукт', 'обед', 'ужин', 'завтрак', 'кафе', 'ресторан', 'кофе', 'перекус', 'магнум',
    'супермаркет', 'доставк', 'пицц', 'бургер', 'шаурм', 'хлеб', 'мяс', 'овощ', 'фрукт', 'вкусн', 'питани', 'столов',
    'фастфуд', 'суши', 'чай', 'groceries', 'food', 'lunch', 'dinner',
  ],
  transport: [
    'транспорт', 'такси', 'бензин', 'заправ', 'топлив', 'автобус', 'метро', 'проезд', 'машин', 'парковк', 'яндекс го',
    'indrive', 'uber', 'билет на поезд', 'авиабилет', 'шиномонтаж', 'автомойк', 'мойк', 'taxi', 'fuel', 'transport',
  ],
  entertainment: [
    'развлеч', 'кино', 'театр', 'концерт', 'игр', 'подписк', 'netflix', 'spotify', 'бар', 'клуб', 'боулинг',
    'отдых', 'путешеств', 'отпуск', 'хобби', 'entertainment',
  ],
  clothing: ['одежд', 'обув', 'кроссовк', 'куртк', 'джинс', 'плать', 'футболк', 'рубашк', 'шапк', 'clothes', 'clothing'],
  health: [
    'здоров', 'аптек', 'лекарств', 'врач', 'доктор', 'клиник', 'больниц', 'анализ', 'стоматолог', 'зуб', 'спортзал',
    'фитнес', 'зал', 'массаж', 'витамин', 'health', 'pharmacy',
  ],
  housing: [
    'дом', 'жиль', 'квартир', 'аренд', 'коммунал', 'свет', 'газ', 'вода', 'интернет', 'ремонт', 'мебел', 'посуд', 'быт',
    'уборк', 'хозтовар', 'home', 'housing', 'rent',
  ],
  education: [
    'образован', 'обучен', 'учеб', 'курс', 'школ', 'универ', 'репетитор', 'тренинг', 'семинар', 'книг', 'учебник',
    'education', 'course',
  ],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

/** Слова строки (кириллица/латиница/цифры). */
function words(s: string): string[] {
  return norm(s).split(/[^a-zа-я0-9]+/i).filter(Boolean);
}

function matchStems(text: string): ExpenseCategory | null {
  const t = norm(text);
  const ws = words(text);
  for (const cat of Object.keys(STEMS) as Array<Exclude<ExpenseCategory, 'other'>>) {
    for (const stem of STEMS[cat]) {
      if (stem.includes(' ') ? t.includes(stem) : ws.some((w) => w.startsWith(stem))) return cat;
    }
  }
  return null;
}

/**
 * Канонический ключ. Сначала сама категория (ключ или слово), потом описание.
 * Ничего не узналось → 'other' (и тогда исходный текст стоит сохранить в
 * описании — см. add_expense).
 */
export function normalizeExpenseCategory(raw?: string | null, description?: string | null): ExpenseCategory {
  const r = raw ? norm(raw) : '';
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(r)) return r as ExpenseCategory;
  if (r === 'прочее' || r === 'другое') return 'other';
  if (r === 'home') return 'housing'; // старый ключ сервера
  return (r && matchStems(r)) || (description && matchStems(description)) || 'other';
}
