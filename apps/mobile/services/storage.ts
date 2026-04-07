import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Synchronous-like storage wrapper around AsyncStorage.
 * Uses an in-memory cache for sync reads, with async persistence.
 */
class Storage {
  private cache: Map<string, string> = new Map();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const keys = await AsyncStorage.getAllKeys();
      if (keys.length > 0) {
        const pairs = await AsyncStorage.multiGet(keys);
        for (const [key, value] of pairs) {
          if (value !== null) {
            this.cache.set(key, value);
          }
        }
      }
    } catch {
      // Silently fail — cache will be empty
    }
    this.loaded = true;
  }

  getString(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  }

  remove(key: string): void {
    this.cache.delete(key);
    AsyncStorage.removeItem(key).catch(() => {});
  }

  getBoolean(key: string): boolean | undefined {
    const val = this.cache.get(key);
    if (val === undefined) return undefined;
    return val === 'true';
  }

  setBoolean(key: string, value: boolean): void {
    this.set(key, String(value));
  }
}

export const storage = new Storage();
