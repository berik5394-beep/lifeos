import { useEffect, useRef, useState } from 'react';

/** Скорость «печати» реплики робота (мс на символ) — как в аниме и визуальных новеллах. */
export const TYPEWRITER_MS_PER_CHAR = 28;

/**
 * Сколько текста видно через `elapsedMs` после начала печати. Режем по символам
 * (Array.from), а не по UTF-16 — эмодзи не разваливаются на половинки.
 */
export function typewriterSlice(text: string, elapsedMs: number, msPerChar = TYPEWRITER_MS_PER_CHAR): string {
  const chars = Array.from(text);
  const n = Math.max(0, Math.floor(elapsedMs / msPerChar));
  return chars.slice(0, Math.min(chars.length, n)).join('');
}

/** Текст «печатается» по буквам; enabled=false — сразу целиком (история сообщений). */
export function useTypewriter(text: string, enabled = true, msPerChar = TYPEWRITER_MS_PER_CHAR): string {
  const [shown, setShown] = useState(enabled ? '' : text);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }
    // Текст дописался (ответ идёт потоком) — печатаем дальше с того же места,
    // а не заново с первой буквы на каждом куске (2026-11-10).
    const prev = shownRef.current;
    const base = prev && text.startsWith(prev) ? Array.from(prev).length : 0;
    const start = Date.now() - base * msPerChar;
    if (!base) setShown('');
    const t = setInterval(() => {
      const s = typewriterSlice(text, Date.now() - start, msPerChar);
      setShown(s);
      if (s.length >= text.length) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [text, enabled, msPerChar]);

  return shown;
}
