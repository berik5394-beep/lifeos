import { Platform } from 'react-native';

/**
 * Crash Reporting Service
 *
 * Сбои приложения: консоль + отчёт на сервер (POST /client-errors → лог + пуш).
 * Позже можно заменить на Sentry — интерфейс тот же.
 *
 * Usage:
 *   import { crashReporting } from '@/services/crash-reporting';
 *   crashReporting.captureException(error);
 *   crashReporting.setUser(userId);
 */

interface CrashReportingService {
  init(): void;
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
  setUser(userId: string | null): void;
  addBreadcrumb(message: string, category?: string): void;
}

/** Один и тот же сбой — не чаще раза в минуту; за запуск — не больше 20 отчётов. */
const SAME_ERROR_MS = 60_000;
const MAX_PER_SESSION = 20;
const sentAt = new Map<string, number>();
let sentCount = 0;

/** Слать ли этот сбой сейчас (тестируется). */
export function shouldSendCrash(signature: string, now: number): boolean {
  if (sentCount >= MAX_PER_SESSION) return false;
  const last = sentAt.get(signature);
  if (last !== undefined && now - last < SAME_ERROR_MS) return false;
  sentAt.set(signature, now);
  sentCount += 1;
  return true;
}

export function resetCrashThrottle(): void {
  sentAt.clear();
  sentCount = 0;
}

export interface CrashPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
  fatal?: boolean;
  platform?: string;
  appVersion?: string;
}

/** Что уходит на сервер: текст ошибки, стек, экран. Без данных пользователя. */
export function buildCrashPayload(error: unknown, context: Record<string, unknown> = {}): CrashPayload {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  return {
    message: (err.message || err.name || 'Error').slice(0, 500),
    stack: str(err.stack, 4000),
    componentStack: str(context.componentStack, 4000),
    route: str(context.route, 80),
    fatal: context.fatal === true ? true : undefined,
    platform: Platform.OS,
    appVersion: str(context.appVersion, 40),
  };
}

/**
 * Отправить на сервер (POST /client-errors → лог Railway + пуш тебе).
 * Никогда не бросает; в разработке — только консоль.
 */
function sendCrash(error: unknown, context: Record<string, unknown> = {}): void {
  if (__DEV__) return;
  void (async () => {
    try {
      const [{ api }, { useAuthStore }, { currentRouteName }, Constants] = await Promise.all([
        import('@/services/api'),
        import('@/stores/auth-store'),
        import('@/navigation/ref'),
        import('expo-constants'),
      ]);
      const payload = buildCrashPayload(error, {
        ...context,
        route: context.route ?? currentRouteName() ?? undefined,
        appVersion: Constants.default.expoConfig?.version,
      });
      if (!shouldSendCrash(`${payload.route ?? ''}|${payload.message}`, Date.now())) return;
      await api.post('/client-errors', payload, useAuthStore.getState().token, { timeoutMs: 8000 });
    } catch {
      // нет сети / сервер недоступен — сбой останется только в консоли
    }
  })();
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (h: GlobalHandler) => void;
}
let installed = false;

// ── Реализация: консоль + отчёт на сервер (2026-11-10) ──────────────────────
// Раньше сбои у пользователя писались только в консоль телефона — мы о них не
// узнавали. Sentry можно подключить позже вместо sendCrash.
const consoleCrashReporting: CrashReportingService = {
  init() {
    if (installed) return;
    installed = true;
    // Необработанные JS-ошибки (вне экранов с ErrorBoundary) — тоже на сервер.
    const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (eu) {
      const prev = eu.getGlobalHandler();
      eu.setGlobalHandler((error, isFatal) => {
        sendCrash(error, { fatal: isFatal === true });
        prev(error, isFatal);
      });
    }
  },

  captureException(error: unknown, context?: Record<string, unknown>) {
    console.error('[CrashReporting] Exception:', error, context);
    sendCrash(error, context);
  },

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    const logFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.debug;
    logFn(`[CrashReporting] ${level}: ${message}`);
    if (level === 'error') sendCrash(new Error(message));
  },

  setUser(userId: string | null) {
    if (__DEV__) {
      console.debug('[CrashReporting] User:', userId);
    }
  },

  addBreadcrumb(message: string, category = 'default') {
    if (__DEV__) {
      console.debug(`[CrashReporting] Breadcrumb [${category}]: ${message}`);
    }
  },
};

export const crashReporting: CrashReportingService = consoleCrashReporting;
