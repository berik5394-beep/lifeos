import { Platform } from 'react-native';

/**
 * Робот-эпик: реплики робота — как в комиксах/аниме: белое облачко с жирным
 * чёрным контуром, жёсткая тень без размытия, «рукописный» шрифт.
 */
export const COMIC = {
  ink: '#14101F',
  paper: '#FFFFFF',
  outline: 3,
  shadow: 4,
  /** iOS: системный Chalkboard (комиксовый); Android: узкий системный. */
  font: Platform.select({ ios: 'ChalkboardSE-Bold', android: 'sans-serif-condensed', default: undefined }),
} as const;
