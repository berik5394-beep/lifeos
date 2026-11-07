/**
 * Говорить по фразам, пока ответ ещё пишется (jarvis-roadmap №5, потоковый
 * ответ): куски текста копятся, законченная фраза (. ! ? … + пробел) сразу
 * уходит в озвучку. В конце — сверка с итогом: совпал — договорить хвост; итог
 * другой (подтверждение денег, запасной путь) — замолчать и сказать итог целиком.
 * Чистая логика: озвучка и остановка — снаружи (тесты держат без звука).
 */
export interface SentenceSpeaker {
  push: (delta: string) => void;
  /** Итог хода. streamed — что сервер отдал кусками (для сверки). */
  finish: (finalText: string, streamed: string) => void;
  /** Сколько фраз уже отдано в озвучку. */
  spokenCount: () => number;
}

// Конец фразы: знак + (кавычка/скобка/разметка жирного) + пробел.
const BOUNDARY = /[.!?…]+["»)*_]*\s+/g;
/** Для сверки: без разметки (сервер снимает её с итога) и лишних пробелов. */
const norm = (s: string) => s.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();

export function createSentenceSpeaker(say: (sentence: string) => void, stop: () => void): SentenceSpeaker {
  let buf = '';
  let count = 0;
  const flush = (text: string) => {
    const t = text.trim();
    if (t.length < 2) return;
    count += 1;
    say(t);
  };
  return {
    push(delta) {
      buf += delta;
      let last = 0;
      BOUNDARY.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BOUNDARY.exec(buf)) !== null) {
        const end = m.index + m[0].length;
        flush(buf.slice(last, end));
        last = end;
      }
      buf = buf.slice(last);
    },
    finish(finalText, streamed) {
      if (count === 0) {
        // Кусков не было (быстрая команда) — сказать итог целиком.
        flush(finalText);
        return;
      }
      const f = norm(finalText);
      const st = norm(streamed);
      if (f.startsWith(st)) {
        flush(buf); // договорить хвост без точки
        flush(f.slice(st.length)); // и то, что сервер дописал к итогу (ссылка и т.п.)
      } else {
        stop();
        count = 0;
        flush(finalText);
      }
      buf = '';
    },
    spokenCount: () => count,
  };
}
