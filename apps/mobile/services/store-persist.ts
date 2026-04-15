import AsyncStorage from '@react-native-async-storage/async-storage';

const PERSIST_PREFIX = 'lifeos_store_';
const PERSIST_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface PersistedData<T> {
  data: T;
  timestamp: number;
}

/**
 * Persist a subset of store data to AsyncStorage.
 * Call this after successful API fetches.
 */
export async function persistStoreData<T>(
  storeKey: string,
  data: T,
): Promise<void> {
  try {
    const payload: PersistedData<T> = {
      data,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(
      `${PERSIST_PREFIX}${storeKey}`,
      JSON.stringify(payload),
    );
  } catch (err) {
    console.warn(`[StorePersist] Failed to save ${storeKey}:`, err);
  }
}

/**
 * Restore persisted store data if available and not stale.
 * Returns null if no data or expired.
 */
export async function restoreStoreData<T>(
  storeKey: string,
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PERSIST_PREFIX}${storeKey}`);
    if (!raw) return null;

    const payload: PersistedData<T> = JSON.parse(raw);
    if (Date.now() - payload.timestamp > PERSIST_TTL) {
      // Stale data — remove it
      await AsyncStorage.removeItem(`${PERSIST_PREFIX}${storeKey}`);
      return null;
    }

    return payload.data;
  } catch (err) {
    console.warn(`[StorePersist] Failed to restore ${storeKey}:`, err);
    return null;
  }
}

/**
 * Clear all persisted store data (e.g., on logout).
 */
export async function clearPersistedStores(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const storeKeys = keys.filter((k) => k.startsWith(PERSIST_PREFIX));
    if (storeKeys.length > 0) {
      await AsyncStorage.multiRemove(storeKeys);
    }
  } catch (err) {
    console.warn('[StorePersist] Failed to clear:', err);
  }
}
