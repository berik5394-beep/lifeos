/**
 * Tests for store-persist service.
 *
 * IMPORTANT: The global setup.ts mocks @/services/store-persist, but that mock
 * only affects modules that import it. Here we test the ACTUAL implementation
 * by importing the real module via jest.requireActual, and we test against
 * the AsyncStorage mock that setup.ts provides.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Get the REAL implementation, bypassing the setup.ts mock
const {
  persistStoreData,
  restoreStoreData,
  clearPersistedStores,
} = jest.requireActual('@/services/store-persist') as typeof import('@/services/store-persist');

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(async () => {
  // Clear the in-memory store backing AsyncStorage mock
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('store-persist', () => {
  describe('persistStoreData', () => {
    it('saves data with timestamp to AsyncStorage', async () => {
      const data = { totalExpenses: 5000, balance: 10000 };

      await persistStoreData('finance_summary', data);

      expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = mockStorage.setItem.mock.calls[0];
      expect(key).toBe('lifeos_store_finance_summary');

      const parsed = JSON.parse(value as string);
      expect(parsed.data).toEqual(data);
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('handles setItem error gracefully', async () => {
      mockStorage.setItem.mockRejectedValueOnce(new Error('Storage full'));

      // Should not throw
      await expect(persistStoreData('test', { a: 1 })).resolves.toBeUndefined();
    });
  });

  describe('restoreStoreData', () => {
    it('returns stored data when fresh', async () => {
      const data = [{ id: '1', name: 'Чтение' }];
      const payload = { data, timestamp: Date.now() };
      await AsyncStorage.setItem('lifeos_store_habits', JSON.stringify(payload));

      const result = await restoreStoreData('habits');

      expect(result).toEqual(data);
    });

    it('returns null when no data stored', async () => {
      const result = await restoreStoreData('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null and removes stale data (TTL expired)', async () => {
      const data = { old: true };
      const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      const payload = { data, timestamp: staleTimestamp };
      await AsyncStorage.setItem('lifeos_store_stale_key', JSON.stringify(payload));

      const result = await restoreStoreData('stale_key');

      expect(result).toBeNull();
      expect(mockStorage.removeItem).toHaveBeenCalledWith('lifeos_store_stale_key');
    });

    it('returns data when just under TTL', async () => {
      const data = { fresh: true };
      const freshTimestamp = Date.now() - 23 * 60 * 60 * 1000; // 23 hours ago
      const payload = { data, timestamp: freshTimestamp };
      await AsyncStorage.setItem('lifeos_store_fresh_key', JSON.stringify(payload));

      const result = await restoreStoreData('fresh_key');

      expect(result).toEqual(data);
    });

    it('handles getItem error gracefully', async () => {
      mockStorage.getItem.mockRejectedValueOnce(new Error('Read error'));

      const result = await restoreStoreData('broken');

      expect(result).toBeNull();
    });
  });

  describe('clearPersistedStores', () => {
    it('removes all lifeos_store_ prefixed keys', async () => {
      await AsyncStorage.setItem('lifeos_store_habits', '{}');
      await AsyncStorage.setItem('lifeos_store_tasks', '{}');
      await AsyncStorage.setItem('other_key', '{}');

      await clearPersistedStores();

      expect(mockStorage.multiRemove).toHaveBeenCalledWith(
        expect.arrayContaining(['lifeos_store_habits', 'lifeos_store_tasks']),
      );
      // 'other_key' should not be in the removal list
      const removedKeys = mockStorage.multiRemove.mock.calls[0][0] as string[];
      expect(removedKeys).not.toContain('other_key');
    });

    it('does nothing when no store keys exist', async () => {
      await AsyncStorage.setItem('unrelated_key', '{}');

      await clearPersistedStores();

      expect(mockStorage.multiRemove).not.toHaveBeenCalled();
    });

    it('handles getAllKeys error gracefully', async () => {
      mockStorage.getAllKeys.mockRejectedValueOnce(new Error('Keys error'));

      // Should not throw
      await expect(clearPersistedStores()).resolves.toBeUndefined();
    });
  });
});
