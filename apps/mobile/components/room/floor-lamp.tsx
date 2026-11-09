import React, { memo } from 'react';
import Svg, { Defs, Ellipse, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Торшер в комнате (Berik 2026-11-09: «лампочка почему-то ставится на пол»).
 * Мебель рисуется эмодзи, а эмодзи торшера нет — была 💡 на полу. Здесь —
 * абажур на ножке с тёплым светом; в магазине значок остаётся 💡 «Свет».
 */
export const FloorLamp = memo(function FloorLamp({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="lampGlow" cx="50%" cy="30%" r="50%">
          <Stop offset="0%" stopColor="#FFE8A3" stopOpacity="0.85" />
          <Stop offset="100%" stopColor="#FFE8A3" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* тёплое пятно света вокруг абажура */}
      <Ellipse cx="50" cy="30" rx="44" ry="30" fill="url(#lampGlow)" />
      {/* абажур */}
      <Path d="M30 14 L70 14 L80 42 L20 42 Z" fill="#F4D7A1" stroke="#8A5A2B" strokeWidth="2.5" strokeLinejoin="round" />
      <Path d="M24 36 L76 36" stroke="#D9A75F" strokeWidth="2" />
      {/* ножка и основание */}
      <Rect x="47.5" y="42" width="5" height="44" rx="2" fill="#5B4636" />
      <Ellipse cx="50" cy="88" rx="16" ry="5" fill="#4A372A" />
    </Svg>
  );
});
