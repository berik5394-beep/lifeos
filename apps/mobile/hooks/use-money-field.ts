import { useCallback, useMemo, useState } from 'react';
import { parseMoneyInput, type MoneyParse } from '@/services/deals-view';

/**
 * Поле суммы в формах «Сделок»: ошибку показываем по уходу с поля или по «Сохранить»,
 * а не на каждой букве («2,» посреди ввода — ещё не ошибка). Печатаешь — ошибка прячется.
 */
export function useMoneyField(): {
  text: string;
  setText: (t: string) => void;
  parsed: MoneyParse;
  error: string | undefined;
  onBlur: () => void;
  /** Показать ошибку (по «Сохранить»); true — сумма годится. */
  validate: () => boolean;
  reset: (initial: string) => void;
} {
  const [text, setRaw] = useState('');
  const [shown, setShown] = useState(false);
  const parsed = useMemo(() => parseMoneyInput(text), [text]);

  const setText = useCallback((t: string) => {
    setRaw(t);
    setShown(false);
  }, []);
  const onBlur = useCallback(() => setShown(true), []);
  const validate = useCallback(() => {
    setShown(true);
    return parsed.ok;
  }, [parsed]);
  const reset = useCallback((initial: string) => {
    setRaw(initial);
    setShown(false);
  }, []);

  return { text, setText, parsed, error: shown && !parsed.ok ? parsed.error : undefined, onBlur, validate, reset };
}
