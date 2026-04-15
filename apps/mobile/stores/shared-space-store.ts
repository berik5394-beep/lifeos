import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface SharedSpaceMember {
  id: string;
  userId: string;
  role: string;
  user?: { name: string; email: string };
}

export interface SharedSpace {
  id: string;
  name: string;
  ownerId: string;
  members: SharedSpaceMember[];
  taskCount: number;
}

interface SharedSpaceState {
  spaces: SharedSpace[];
  loading: boolean;
  fetchSpaces: () => Promise<void>;
  createSpace: (name: string) => Promise<void>;
  addMember: (spaceId: string, email: string) => Promise<void>;
  removeMember: (spaceId: string, userId: string) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;
}

export const useSharedSpaceStore = create<SharedSpaceState>((set) => ({
  spaces: [],
  loading: false,

  fetchSpaces: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ loading: true });
    try {
      const spaces = await api.get<SharedSpace[]>('/shared-spaces', token);
      set({ spaces, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createSpace: async (name: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const space = await api.post<SharedSpace>('/shared-spaces', { name }, token);
      set((state) => ({ spaces: [...state.spaces, space] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при создании пространства';
      throw new Error(msg);
    }
  },

  addMember: async (spaceId: string, email: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const updatedSpace = await api.post<SharedSpace>(
        `/shared-spaces/${spaceId}/members`,
        { email },
        token,
      );
      set((state) => ({
        spaces: state.spaces.map((s) => (s.id === spaceId ? updatedSpace : s)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при добавлении участника';
      throw new Error(msg);
    }
  },

  removeMember: async (spaceId: string, userId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/shared-spaces/${spaceId}/members/${userId}`, token);
      set((state) => ({
        spaces: state.spaces.map((s) =>
          s.id === spaceId
            ? { ...s, members: s.members.filter((m) => m.userId !== userId) }
            : s,
        ),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении участника';
      throw new Error(msg);
    }
  },

  deleteSpace: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/shared-spaces/${id}`, token);
      set((state) => ({
        spaces: state.spaces.filter((s) => s.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении пространства';
      throw new Error(msg);
    }
  },
}));
