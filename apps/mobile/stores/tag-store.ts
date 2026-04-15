import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface Tag {
  id: string;
  name: string;
  color: string;
}

interface TagState {
  tags: Tag[];
  loading: boolean;
  fetchTags: () => Promise<void>;
  createTag: (name: string, color: string) => Promise<void>;
  updateTag: (id: string, name: string, color: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  attachTagToTask: (tagId: string, taskId: string) => Promise<void>;
  detachTagFromTask: (tagId: string, taskId: string) => Promise<void>;
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],
  loading: false,

  fetchTags: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ loading: true });
    try {
      const tags = await api.get<Tag[]>('/tags', token);
      set({ tags, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createTag: async (name: string, color: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const tag = await api.post<Tag>('/tags', { name, color }, token);
      set((state) => ({ tags: [...state.tags, tag] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при создании тега';
      throw new Error(msg);
    }
  },

  updateTag: async (id: string, name: string, color: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const updated = await api.put<Tag>(`/tags/${id}`, { name, color }, token);
      set((state) => ({
        tags: state.tags.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при обновлении тега';
      throw new Error(msg);
    }
  },

  deleteTag: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/tags/${id}`, token);
      set((state) => ({
        tags: state.tags.filter((t) => t.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении тега';
      throw new Error(msg);
    }
  },

  attachTagToTask: async (tagId: string, taskId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.post(`/tags/${tagId}/tasks/${taskId}`, {}, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при привязке тега';
      throw new Error(msg);
    }
  },

  detachTagFromTask: async (tagId: string, taskId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/tags/${tagId}/tasks/${taskId}`, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при отвязке тега';
      throw new Error(msg);
    }
  },
}));
