/**
 * Робот-эпик: комната робота в духе квартиры в СНГ — обои в полоску, ковёр
 * на стене, окно с тюлем и шторами, чугунная батарея, деревянный пол,
 * абажур. Тёплые приглушённые цвета, чтобы комната читалась на тёмном UI.
 */
export { RENDER_SCALE } from '@/services/room-geometry';

export const ROOM_PALETTE = {
  wallpaper: '#B79F78',
  wallpaperStripe: '#A88F68',
  wallpaperDot: '#C9B38C',
  carpet: '#8A1E2C',
  carpetBorder: '#C9A227',
  carpetInner: '#5E1420',
  carpetMotif: '#D9B45A',
  windowFrame: '#EDEAE2',
  windowSill: '#E2DED3',
  curtain: '#6E2433',
  curtainFold: '#5A1C2A',
  tulle: 'rgba(255,255,255,0.28)',
  radiator: '#E7E3DA',
  radiatorShade: '#C9C4B8',
  floor: '#8A5A33',
  floorSeam: '#6F4526',
  plinth: '#5A3820',
  lampCord: '#3A2E26',
  lampShade: '#D88A3D',
} as const;

/** Цвет неба в окне по времени суток. */
export function skyColor(hour: number): string {
  if (hour >= 21 || hour < 6) return '#1B2340'; // ночь
  if (hour < 9) return '#F2C38B'; // рассвет
  if (hour >= 18) return '#E39A6B'; // закат
  return '#9FCBEB'; // день
}
