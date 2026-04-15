/**
 * Sync phone contacts to server for AI voice assistant lookup.
 */
import * as Contacts from 'expo-contacts';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export async function requestContactsPermission(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === 'granted';
}

export async function syncContacts(): Promise<number> {
  const token = useAuthStore.getState().token;
  if (!token) return 0;

  const { status } = await Contacts.getPermissionsAsync();
  if (status !== 'granted') return 0;

  try {
    const { data } = await Contacts.getContactsAsync({
      fields: [
        Contacts.Fields.Name,
        Contacts.Fields.PhoneNumbers,
        Contacts.Fields.Emails,
        Contacts.Fields.Birthday,
      ],
    });

    if (data.length === 0) return 0;

    const contacts = data
      .filter((c) => c.name)
      .map((c) => ({
        phoneId: c.id || '',
        name: c.name || '',
        phone: c.phoneNumbers?.[0]?.number || null,
        email: c.emails?.[0]?.email || null,
        birthday: c.birthday
          ? `${c.birthday.year || 2000}-${String((c.birthday.month || 0) + 1).padStart(2, '0')}-${String(c.birthday.day || 1).padStart(2, '0')}`
          : null,
      }));

    await api.post('/contacts/sync', { contacts }, token);
    return contacts.length;
  } catch (err) {
    console.error('Ошибка синхронизации контактов:', err);
    return 0;
  }
}

export async function searchLocalContacts(query: string): Promise<Array<{ name: string; phone: string | null }>> {
  const { status } = await Contacts.getPermissionsAsync();
  if (status !== 'granted') return [];

  try {
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      name: query,
    });

    return data
      .filter((c) => c.name)
      .slice(0, 10)
      .map((c) => ({
        name: c.name || '',
        phone: c.phoneNumbers?.[0]?.number || null,
      }));
  } catch {
    return [];
  }
}
