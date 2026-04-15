import { Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

const APP_STORE_URL = 'https://apps.apple.com/app/lifeos/id0000000000';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.lifeos.app';

interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  forceUpdate: boolean;
  updateUrl: string;
}

/**
 * Check if a newer version is available.
 * Server should provide GET /app/version endpoint.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const currentVersion = Constants.expoConfig?.version ?? '1.0.0';
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

    const response = await fetch(`${apiUrl}/app/version`, {
      method: 'GET',
      headers: { 'X-App-Version': currentVersion, 'X-Platform': Platform.OS },
    });

    if (!response.ok) return;

    const data: VersionInfo = await response.json();

    if (data.latestVersion === currentVersion) return;

    if (isNewerVersion(data.latestVersion, currentVersion)) {
      const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;

      if (data.forceUpdate) {
        Alert.alert(
          'Обновление обязательно',
          'Доступна новая версия LifeOS. Пожалуйста, обновите приложение.',
          [{ text: 'Обновить', onPress: () => Linking.openURL(storeUrl) }],
          { cancelable: false },
        );
      } else {
        Alert.alert(
          'Доступно обновление',
          `Версия ${data.latestVersion} уже доступна. Обновить?`,
          [
            { text: 'Позже', style: 'cancel' },
            { text: 'Обновить', onPress: () => Linking.openURL(storeUrl) },
          ],
        );
      }
    }
  } catch {
    // Non-critical — silently fail
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);

  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
