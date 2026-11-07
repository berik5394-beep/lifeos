/**
 * Кнопки и надписи поверх комнаты — без подложек и рамок (Berik 2026-11-07:
 * «пусть кнопки будут просто кнопками»). Тёмные чернила + мягкий светлый ореол,
 * чтобы читались и на светлом потолке, и на тёмной мебели.
 */
export const ROOM_INK = '#2B2118';

export const ROOM_INK_HALO = {
  textShadowColor: 'rgba(255,255,255,0.8)',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 4,
} as const;
