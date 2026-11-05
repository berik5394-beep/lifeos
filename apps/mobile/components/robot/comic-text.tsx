import React, { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { COMIC } from '@/constants/comic';
import { useTypewriter } from '@/hooks/use-typewriter';

/**
 * Текст реплики робота комиксовым шрифтом. typewrite — печатается по буквам;
 * место под полный текст зарезервировано, облачко не «прыгает» по размеру.
 */
export const ComicText = memo(function ComicText({
  text,
  typewrite = false,
  style,
}: {
  text: string;
  typewrite?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const shown = useTypewriter(text, typewrite);
  return (
    <View accessible accessibilityLabel={text}>
      <Text style={[styles.text, style, typewrite && styles.ghost]}>{text}</Text>
      {typewrite && <Text style={[styles.text, style, styles.overlay]}>{shown}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  text: { fontFamily: COMIC.font, fontSize: 15, lineHeight: 21, color: COMIC.ink },
  ghost: { opacity: 0 },
  overlay: { position: 'absolute', left: 0, top: 0, right: 0 },
});
