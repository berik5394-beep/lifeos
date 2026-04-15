/**
 * Offline Manager — обеспечивает работу приложения без интернета.
 *
 * 1. Мониторит сеть (NetInfo)
 * 2. Кэширует данные из сторов в MMKV
 * 3. Очередь мутаций (создание/обновление/удаление) — выполняется при восстановлении сети
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Network Monitor ────────────────────────────────────────────────────────

type NetworkListener = (isConnected: boolean) => void;

class NetworkMonitor {
  private _isConnected = true;
  private listeners: Set<NetworkListener> = new Set();
  private unsubscribe: (() => void) | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  /** Start monitoring network state. Call once at app startup. */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = !!(state.isConnected && state.isInternetReachable !== false);
      if (connected !== this._isConnected) {
        this._isConnected = connected;
        this.listeners.forEach((fn) => fn(connected));
      }
    });

    // Initial check
    NetInfo.fetch().then((state) => {
      this._isConnected = !!(state.isConnected && state.isInternetReachable !== false);
    }).catch(() => { /* assume online */ });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Subscribe to connectivity changes */
  onChange(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export const networkMonitor = new NetworkMonitor();

// ─── Offline Queue ──────────────────────────────────────────────────────────

interface QueuedMutation {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  body?: unknown;
  createdAt: number;
  retryCount?: number;
}

const QUEUE_KEY = 'lifeos_offline_queue';
const MAX_RETRIES = 5;
const MAX_QUEUE_AGE = 48 * 60 * 60 * 1000; // 48 hours

class OfflineQueue {
  private queue: QueuedMutation[] = [];
  private isSyncing = false;

  /** Load persisted queue from storage */
  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      if (raw) {
        this.queue = JSON.parse(raw);
      }
    } catch {
      this.queue = [];
    }
  }

  /** Add a mutation to the offline queue */
  async enqueue(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<void> {
    const entry: QueuedMutation = {
      ...mutation,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    this.queue.push(entry);
    await this.persist();
  }

  /** Get number of pending mutations */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Process all queued mutations (called when network restored) */
  async sync(
    executor: (mutation: QueuedMutation) => Promise<boolean>
  ): Promise<{ success: number; failed: number }> {
    if (this.isSyncing || this.queue.length === 0) {
      return { success: 0, failed: 0 };
    }

    this.isSyncing = true;
    let success = 0;
    let failed = 0;

    // Prune stale mutations before processing
    const now = Date.now();
    const toProcess = this.queue.filter((m) => {
      if (now - m.createdAt > MAX_QUEUE_AGE) { failed++; return false; }
      if ((m.retryCount ?? 0) >= MAX_RETRIES) { failed++; return false; }
      return true;
    });
    const remaining: QueuedMutation[] = [];

    for (const mutation of toProcess) {
      try {
        const ok = await executor(mutation);
        if (ok) {
          success++;
        } else {
          // Non-retryable failure — drop it
          failed++;
        }
      } catch {
        // Network error — keep in queue with incremented retry count
        remaining.push({ ...mutation, retryCount: (mutation.retryCount ?? 0) + 1 });
      }
    }

    this.queue = remaining;
    await this.persist();
    this.isSyncing = false;

    return { success, failed };
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      // Silent fail
    }
  }
}

export const offlineQueue = new OfflineQueue();

// ─── Data Cache ─────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'lifeos_cache_';

/**
 * Cache API response data locally for offline access.
 * Uses AsyncStorage (works on all platforms, persistent).
 */
export async function cacheData(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ data, cachedAt: Date.now() })
    );
  } catch {
    // Storage full or error — skip
  }
}

/**
 * Get cached data. Returns null if not cached or expired.
 * @param maxAgeMs - max cache age in ms (default: 24 hours)
 */
export async function getCachedData<T>(
  key: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { data: T; cachedAt: number };
    const age = Date.now() - parsed.cachedAt;

    if (age > maxAgeMs) return null; // Expired

    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Clear all cached data (e.g., on logout).
 */
export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // Silent fail
  }
}

// ─── Initialize ─────────────────────────────────────────────────────────────

/** Call once at app startup */
export async function initOfflineManager(): Promise<void> {
  // Start monitoring network
  networkMonitor.start();

  // Load pending offline mutations
  await offlineQueue.load();
}
