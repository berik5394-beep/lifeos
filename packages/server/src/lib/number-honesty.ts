/**
 * Гард честности чисел: в тексте модели нет чисел, которых нет в фактах.
 * Был только у утреннего брифа; теперь общий — пояснения робота к вкладкам,
 * нуджи без шаблона, пересказ рефлектора. Числа с пробелами-разделителями
 * тысяч («85 000») сравниваются как числа.
 */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d\s]*\d|\d/g) ?? []).map((n) => n.replace(/\s/g, ''));
}

export function numbersHonest(text: string, facts: string): boolean {
  const allowed = new Set(numbersIn(facts));
  return numbersIn(text).every((n) => allowed.has(n));
}
