/**
 * Deep Linking — открытие мессенджеров, карт, такси из LifeOS.
 */
import { Linking, Platform } from 'react-native';

export async function openWhatsApp(phone: string, text: string): Promise<boolean> {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const url = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return true;
  }
  // Fallback: web WhatsApp
  await Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`);
  return true;
}

export async function openTelegram(username: string, text?: string): Promise<boolean> {
  try {
    const url = text
      ? `tg://msg?to=${username}&text=${encodeURIComponent(text)}`
      : `tg://resolve?domain=${username}`;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function openSMS(phone: string, text: string): Promise<boolean> {
  try {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    await Linking.openURL(`sms:${phone}${separator}body=${encodeURIComponent(text)}`);
    return true;
  } catch {
    return false;
  }
}

export async function makeCall(phone: string): Promise<boolean> {
  try {
    await Linking.openURL(`tel:${phone}`);
    return true;
  } catch {
    return false;
  }
}

export async function openMapsRoute(destination: string, mode: 'driving' | 'transit' | 'walking' = 'driving'): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(destination);
    if (Platform.OS === 'ios') {
      await Linking.openURL(`maps://app?daddr=${encoded}&dirflg=${mode === 'driving' ? 'd' : mode === 'transit' ? 'r' : 'w'}`);
    } else {
      await Linking.openURL(`google.navigation:q=${encoded}&mode=${mode[0]}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function open2GIS(query: string): Promise<boolean> {
  try {
    const url = `dgis://2gis.ru/search/${encodeURIComponent(query)}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      await Linking.openURL(`https://2gis.kz/astana/search/${encodeURIComponent(query)}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function openTaxi(destination: string): Promise<boolean> {
  try {
    // Яндекс Go first (popular in KZ)
    const yandexUrl = 'yandextaxi://route';
    const canOpenYandex = await Linking.canOpenURL(yandexUrl);
    if (canOpenYandex) {
      await Linking.openURL(yandexUrl);
      return true;
    }
    // Fallback: Uber
    await Linking.openURL(`uber://?action=setPickup&dropoff[formatted_address]=${encodeURIComponent(destination)}`);
    return true;
  } catch {
    return false;
  }
}

export async function openURL(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
