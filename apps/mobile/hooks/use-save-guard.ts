import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Сохранение формы без двойного тапа: синхронный замок (ref) + saving для кнопки.
 * Второй тап, пока идёт запрос, игнорируется. Открыли форму заново — замок снят.
 */
export function useSaveGuard(visible: boolean): {
  saving: boolean;
  guard: (task: () => Promise<void>) => Promise<void>;
} {
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    inFlight.current = false;
    setSaving(false);
  }, [visible]);

  const guard = useCallback(async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);

  return { saving, guard };
}
