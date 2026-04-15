/* Global test setup — mock native modules that are unavailable in Jest */

// Mock react-native-mmkv (storage)
jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
      contains: (key: string) => store.has(key),
      getAllKeys: () => [...store.keys()],
      clearAll: () => store.clear(),
    })),
  };
});

// Mock @/services/storage — re-use the in-memory MMKV mock
jest.mock('@/services/storage', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
      remove: (key: string) => store.delete(key),
      contains: (key: string) => store.has(key),
      getAllKeys: () => [...store.keys()],
      clearAll: () => store.clear(),
    },
  };
});

// Mock @/services/api
jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock @/stores/auth-store
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: jest.fn(() => ({ token: 'test-token-123' })),
  },
}));

// Mock AsyncStorage (used by store-persist and offline-manager)
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      setItem: jest.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
      removeItem: jest.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
      getAllKeys: jest.fn(() => Promise.resolve([...store.keys()])),
      multiGet: jest.fn((keys: string[]) => Promise.resolve(keys.map((k) => [k, store.get(k) ?? null]))),
      multiRemove: jest.fn((keys: string[]) => { keys.forEach((k) => store.delete(k)); return Promise.resolve(); }),
      clear: jest.fn(() => { store.clear(); return Promise.resolve(); }),
    },
  };
});

// Mock @/services/store-persist
jest.mock('@/services/store-persist', () => ({
  persistStoreData: jest.fn(() => Promise.resolve()),
  restoreStoreData: jest.fn(() => Promise.resolve(null)),
  clearPersistedStores: jest.fn(() => Promise.resolve()),
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));
