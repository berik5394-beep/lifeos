import { api } from '@/services/api';
import { usePetStore } from '@/stores/pet-store';
import type { PetData } from '@/stores/pet-store';

const mockApi = api as jest.Mocked<typeof api>;

const MOCK_PET_DATA: PetData = {
  pet: {
    id: 'pet-1',
    type: 'cat',
    characterType: 'playful',
    name: 'Барсик',
    health: 80,
    happiness: 75,
    streak: 5,
    mana: 50,
    maxMana: 100,
    lastFed: '2026-04-13T08:00:00Z',
    lastPlayed: '2026-04-13T09:00:00Z',
    costume: null,
    level: 3,
    xp: 250,
    xpToNext: 400,
    stage: 'baby',
    isAlive: true,
    diedAt: null,
    lastActive: '2026-04-13T10:00:00Z',
    roomLevel: 1,
  },
  state: 'content',
  healthBreakdown: {
    habits: 25,
    tasks: 20,
    budget: 15,
    steps: 10,
    journal: 5,
    meals: 5,
  },
};

const FED_PET_DATA: PetData = {
  ...MOCK_PET_DATA,
  pet: { ...MOCK_PET_DATA.pet, health: 90, happiness: 85 },
  state: 'happy',
};

const PLAYED_PET_DATA: PetData = {
  ...MOCK_PET_DATA,
  pet: { ...MOCK_PET_DATA.pet, happiness: 95 },
  state: 'happy',
};

const INITIAL_STATE = {
  petData: null,
  costumes: [],
  isLoading: false,
  lastReaction: null,
};

beforeEach(() => {
  usePetStore.setState(INITIAL_STATE);
  jest.clearAllMocks();
});

describe('usePetStore', () => {
  it('has correct initial state', () => {
    const state = usePetStore.getState();
    expect(state.petData).toBeNull();
    expect(state.costumes).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.lastReaction).toBeNull();
  });

  describe('fetchPet', () => {
    it('fetches and stores pet data', async () => {
      mockApi.get.mockResolvedValueOnce(MOCK_PET_DATA);

      await usePetStore.getState().fetchPet();

      expect(mockApi.get).toHaveBeenCalledWith('/pet', 'test-token-123');
      const state = usePetStore.getState();
      expect(state.petData).toEqual(MOCK_PET_DATA);
      expect(state.petData!.pet.name).toBe('Барсик');
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void;
      const promise = new Promise((r) => { resolve = r; });
      mockApi.get.mockReturnValueOnce(promise as Promise<never>);

      const fetchPromise = usePetStore.getState().fetchPet();
      expect(usePetStore.getState().isLoading).toBe(true);

      resolve!(MOCK_PET_DATA);
      await fetchPromise;
      expect(usePetStore.getState().isLoading).toBe(false);
    });

    it('handles error gracefully', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network error'));

      await usePetStore.getState().fetchPet();

      expect(usePetStore.getState().petData).toBeNull();
      expect(usePetStore.getState().isLoading).toBe(false);
    });
  });

  describe('feedPet', () => {
    it('updates pet data after feeding', async () => {
      usePetStore.setState({ petData: MOCK_PET_DATA });
      mockApi.put.mockResolvedValueOnce(FED_PET_DATA);

      await usePetStore.getState().feedPet();

      expect(mockApi.put).toHaveBeenCalledWith('/pet/feed', {}, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.health).toBe(90);
      expect(usePetStore.getState().petData!.state).toBe('happy');
    });

    it('handles error gracefully', async () => {
      usePetStore.setState({ petData: MOCK_PET_DATA });
      mockApi.put.mockRejectedValueOnce(new Error('fail'));

      await usePetStore.getState().feedPet();

      // petData unchanged on error
      expect(usePetStore.getState().petData).toEqual(MOCK_PET_DATA);
    });
  });

  describe('playWithPet', () => {
    it('updates pet data after playing', async () => {
      usePetStore.setState({ petData: MOCK_PET_DATA });
      mockApi.put.mockResolvedValueOnce(PLAYED_PET_DATA);

      await usePetStore.getState().playWithPet();

      expect(mockApi.put).toHaveBeenCalledWith('/pet/play', {}, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.happiness).toBe(95);
    });
  });

  describe('renamePet', () => {
    it('renames the pet', async () => {
      const renamed: PetData = {
        ...MOCK_PET_DATA,
        pet: { ...MOCK_PET_DATA.pet, name: 'Мурзик' },
      };
      usePetStore.setState({ petData: MOCK_PET_DATA });
      mockApi.put.mockResolvedValueOnce(renamed);

      await usePetStore.getState().renamePet('Мурзик');

      expect(mockApi.put).toHaveBeenCalledWith('/pet/name', { name: 'Мурзик' }, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.name).toBe('Мурзик');
    });
  });

  describe('setPetType', () => {
    it('changes pet type', async () => {
      const dragonPet: PetData = {
        ...MOCK_PET_DATA,
        pet: { ...MOCK_PET_DATA.pet, type: 'dragon' },
      };
      mockApi.put.mockResolvedValueOnce(dragonPet);

      await usePetStore.getState().setPetType('dragon');

      expect(mockApi.put).toHaveBeenCalledWith('/pet/type', { type: 'dragon' }, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.type).toBe('dragon');
    });
  });

  describe('revivePet', () => {
    it('revives a dead pet', async () => {
      const deadPet: PetData = {
        ...MOCK_PET_DATA,
        pet: { ...MOCK_PET_DATA.pet, isAlive: false, diedAt: '2026-04-11T00:00:00Z', health: 0 },
        state: 'dead',
      };
      const revivedPet: PetData = {
        ...MOCK_PET_DATA,
        pet: { ...MOCK_PET_DATA.pet, isAlive: true, diedAt: null, health: 50, level: 1, xp: 0 },
        state: 'content',
      };
      usePetStore.setState({ petData: deadPet });
      mockApi.post.mockResolvedValueOnce(revivedPet);

      await usePetStore.getState().revivePet('perfect_day');

      expect(mockApi.post).toHaveBeenCalledWith('/pet/revive', { method: 'perfect_day' }, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.isAlive).toBe(true);
    });
  });

  describe('triggerReaction', () => {
    it('sets and clears lastReaction', () => {
      jest.useFakeTimers();

      usePetStore.getState().triggerReaction('jump');
      expect(usePetStore.getState().lastReaction).toBe('jump');

      jest.advanceTimersByTime(2000);
      expect(usePetStore.getState().lastReaction).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('fetchCostumes', () => {
    it('fetches costume list', async () => {
      const costumes = [
        { key: 'crown', name: 'Корона', emoji: '👑', unlocked: true, equipped: false },
        { key: 'cape', name: 'Плащ', emoji: '🦸', unlocked: false, equipped: false },
      ];
      mockApi.get.mockResolvedValueOnce(costumes);

      await usePetStore.getState().fetchCostumes();

      expect(mockApi.get).toHaveBeenCalledWith('/pet/costumes', 'test-token-123');
      expect(usePetStore.getState().costumes).toHaveLength(2);
    });
  });

  describe('setCostume', () => {
    it('equips a costume', async () => {
      const costumedPet: PetData = {
        ...MOCK_PET_DATA,
        pet: { ...MOCK_PET_DATA.pet, costume: 'crown' },
      };
      mockApi.put.mockResolvedValueOnce(costumedPet);

      await usePetStore.getState().setCostume('crown');

      expect(mockApi.put).toHaveBeenCalledWith('/pet/costume', { costume: 'crown' }, 'test-token-123');
      expect(usePetStore.getState().petData!.pet.costume).toBe('crown');
    });
  });
});
