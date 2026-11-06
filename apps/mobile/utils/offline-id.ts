/** Временный id записи, созданной без сети (до отправки очереди). */
export function offlineId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isOfflineId(id: string): boolean {
  return id.startsWith('offline-');
}
