/**
 * Crash Reporting Service
 *
 * Abstracts error reporting — currently logs to console.
 * Replace with Sentry, Bugsnag, or Firebase Crashlytics when ready.
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

// ── Console-based implementation (swap for Sentry in production) ────────────
const consoleCrashReporting: CrashReportingService = {
  init() {
    // To enable Sentry:
    // 1. npm install @sentry/react-native
    // 2. Replace this implementation with Sentry.init({ dsn: '...' })
    if (__DEV__) {
      console.debug('[CrashReporting] Initialized (console mode)');
    }
  },

  captureException(error: unknown, context?: Record<string, unknown>) {
    console.error('[CrashReporting] Exception:', error, context);
  },

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    const logFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.debug;
    logFn(`[CrashReporting] ${level}: ${message}`);
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
