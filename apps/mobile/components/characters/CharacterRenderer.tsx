import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Text, type ViewStyle } from 'react-native';
import { CharacterConfig } from '../../constants/characters';
import { Character3D } from './Character3D';

// Faux-3D depth: strong drop shadow + elevation to lift body parts off the canvas.
// Applied inline via style arrays so we don't balloon StyleSheet.create.
const depthLg: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 2, height: 6 },
  shadowOpacity: 0.5,
  shadowRadius: 10,
  elevation: 10,
};
const depthMd: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 1, height: 4 },
  shadowOpacity: 0.4,
  shadowRadius: 6,
  elevation: 6,
};
// Inner rim highlight — thin top-left lighter overlay that simulates directional lighting.
const rimHighlight: ViewStyle = {
  position: 'absolute',
  top: 2,
  left: 2,
  right: '55%',
  bottom: '60%',
  borderRadius: 999,
  backgroundColor: 'rgba(255,255,255,0.18)',
};

interface Props {
  character: CharacterConfig;
  size?: number;
  level?: number;
  showGlow?: boolean;
  equipped?: {
    helmet?: string;
    armor?: string;
    weapon?: string;
    shield?: string;
    boots?: string;
    aura?: string;
  };
  /**
   * Opt-in: render using real three.js primitives via @react-three/fiber/native
   * instead of the legacy 2D <View> stack. Defaults to false so existing
   * screens (arena, battle, character-select) keep rendering exactly the same.
   * Flip to true on a screen-by-screen basis when you're ready to test the 3D path.
   */
  render3D?: boolean;
}

export function CharacterRenderer({ character, size = 200, level = 1, showGlow = true, equipped, render3D = false }: Props) {
  const floatAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scale = size / 200;

  useEffect(() => {
    // Floating animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -8 * scale, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();

    // Glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.8, duration: 1500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 1500, useNativeDriver: true }),
      ])
    ).start();

    // Breathing pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const renderWarrior = () => (
    <View style={[styles.characterBase, { transform: [{ scale }] }]}>
      {/* Helmet / Head */}
      <View style={[styles.helmet, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.helmetVisor, { backgroundColor: character.accentColor }]} />
        {/* Horns */}
        <View style={[styles.hornLeft, depthMd, { backgroundColor: character.accentColor }]} />
        <View style={[styles.hornRight, depthMd, { backgroundColor: character.accentColor }]} />
      </View>
      {/* Eyes */}
      <View style={styles.eyeContainer}>
        <View style={[styles.eye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
        <View style={[styles.eye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
      </View>
      {/* Body / Armor */}
      <View style={[styles.body, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.chestPlate, { backgroundColor: character.accentColor }]} />
        <View style={[styles.belt, { backgroundColor: character.accentColor }]} />
      </View>
      {/* Arms */}
      <View style={[styles.armLeft, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.gauntlet, { backgroundColor: character.armorColor }]} />
      </View>
      <View style={[styles.armRight, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.gauntlet, { backgroundColor: character.armorColor }]} />
        {/* Sword */}
        <View style={[styles.sword, depthMd, { backgroundColor: '#C0C0C0' }]}>
          <View style={[styles.swordHandle, { backgroundColor: character.accentColor }]} />
        </View>
      </View>
      {/* Legs */}
      <View style={styles.legContainer}>
        <View style={[styles.leg, depthMd, { backgroundColor: character.bodyColor }]}>
          <View style={[styles.boot, { backgroundColor: character.armorColor }]} />
        </View>
        <View style={[styles.leg, depthMd, { backgroundColor: character.bodyColor }]}>
          <View style={[styles.boot, { backgroundColor: character.armorColor }]} />
        </View>
      </View>
    </View>
  );

  const renderElf = () => (
    <View style={[styles.characterBase, { transform: [{ scale }] }]}>
      {/* Elven ears + head */}
      <View style={[styles.elfHead, depthLg, { backgroundColor: character.bodyColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.elfEarLeft, { backgroundColor: character.bodyColor, borderColor: character.accentColor }]} />
        <View style={[styles.elfEarRight, { backgroundColor: character.bodyColor, borderColor: character.accentColor }]} />
        {/* Hair */}
        <View style={[styles.elfHair, { backgroundColor: character.armorColor }]} />
        {/* Tiara */}
        <View style={[styles.tiara, depthMd, { backgroundColor: character.accentColor }]}>
          <View style={[styles.tiaraGem, { backgroundColor: character.eyeColor }]} />
        </View>
      </View>
      {/* Eyes */}
      <View style={styles.eyeContainer}>
        <View style={[styles.elfEye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
        <View style={[styles.elfEye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
      </View>
      {/* Body - elegant armor */}
      <View style={[styles.elfBody, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.elfCape, { backgroundColor: character.accentColor, opacity: 0.3 }]} />
        <View style={[styles.elfGem, { backgroundColor: character.eyeColor }]} />
      </View>
      {/* Arms */}
      <View style={[styles.elfArmLeft, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.elfBracer, { backgroundColor: character.armorColor }]} />
      </View>
      <View style={[styles.elfArmRight, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.elfBracer, { backgroundColor: character.armorColor }]} />
        {/* Bow */}
        <View style={[styles.bow, { borderColor: character.accentColor }]} />
      </View>
      {/* Legs */}
      <View style={styles.legContainer}>
        <View style={[styles.elfLeg, depthMd, { backgroundColor: character.bodyColor }]}>
          <View style={[styles.elfBoot, { backgroundColor: character.armorColor }]} />
        </View>
        <View style={[styles.elfLeg, depthMd, { backgroundColor: character.bodyColor }]}>
          <View style={[styles.elfBoot, { backgroundColor: character.armorColor }]} />
        </View>
      </View>
    </View>
  );

  const renderMage = () => (
    <View style={[styles.characterBase, { transform: [{ scale }] }]}>
      {/* Mage hat */}
      <View style={[styles.mageHat, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.mageHatTip, depthMd, { backgroundColor: character.accentColor }]} />
        <View style={[styles.mageHatBrim, { backgroundColor: character.armorColor }]} />
      </View>
      {/* Face */}
      <View style={[styles.mageFace, depthMd, { backgroundColor: character.bodyColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
      </View>
      {/* Eyes */}
      <View style={[styles.eyeContainer, { top: 68 }]}>
        <View style={[styles.mageEye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
        <View style={[styles.mageEye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor }]} />
      </View>
      {/* Robe body */}
      <View style={[styles.mageRobe, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.mageOrb, { backgroundColor: character.accentColor, shadowColor: character.accentColor }]} />
        <View style={[styles.robePattern1, { backgroundColor: character.accentColor }]} />
        <View style={[styles.robePattern2, { backgroundColor: character.accentColor }]} />
      </View>
      {/* Arms + Staff */}
      <View style={[styles.mageArmLeft, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.mageSleeve, { backgroundColor: character.armorColor }]} />
      </View>
      <View style={[styles.mageArmRight, depthMd, { backgroundColor: character.bodyColor }]}>
        <View style={[styles.mageSleeve, { backgroundColor: character.armorColor }]} />
        {/* Staff */}
        <View style={[styles.staff, depthMd, { backgroundColor: '#8B4513' }]}>
          <View style={[styles.staffOrb, { backgroundColor: character.accentColor, shadowColor: character.glowColor }]} />
        </View>
      </View>
      {/* Legs under robe */}
      <View style={styles.legContainer}>
        <View style={[styles.mageLeg, depthMd, { backgroundColor: character.armorColor }]} />
        <View style={[styles.mageLeg, depthMd, { backgroundColor: character.armorColor }]} />
      </View>
    </View>
  );

  const renderGuardian = () => (
    <View style={[styles.characterBase, { transform: [{ scale }] }]}>
      {/* Big helmet */}
      <View style={[styles.guardianHelmet, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.guardianCrest, depthMd, { backgroundColor: character.accentColor }]} />
        <View style={[styles.guardianVisor, { backgroundColor: '#0A1628' }]}>
          <View style={[styles.eye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor, width: 8, height: 4 }]} />
          <View style={[styles.eye, { backgroundColor: character.eyeColor, shadowColor: character.eyeColor, width: 8, height: 4 }]} />
        </View>
      </View>
      {/* Massive body */}
      <View style={[styles.guardianBody, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
        <View pointerEvents="none" style={rimHighlight} />
        <View style={[styles.guardianChest, { backgroundColor: character.accentColor }]} />
        <View style={[styles.guardianCore, { backgroundColor: character.eyeColor, shadowColor: character.glowColor }]} />
      </View>
      {/* Big arms */}
      <View style={[styles.guardianArmLeft, depthMd, { backgroundColor: character.armorColor }]}>
        <View style={[styles.guardianShoulder, { backgroundColor: character.accentColor }]} />
        {/* Big shield */}
        <View style={[styles.bigShield, depthLg, { backgroundColor: character.armorColor, borderColor: character.accentColor }]}>
          <View pointerEvents="none" style={rimHighlight} />
          <View style={[styles.shieldEmblem, { backgroundColor: character.eyeColor }]} />
        </View>
      </View>
      <View style={[styles.guardianArmRight, depthMd, { backgroundColor: character.armorColor }]}>
        <View style={[styles.guardianShoulder, { backgroundColor: character.accentColor }]} />
      </View>
      {/* Thick legs */}
      <View style={styles.legContainer}>
        <View style={[styles.guardianLeg, depthMd, { backgroundColor: character.armorColor }]}>
          <View style={[styles.guardianBoot, { backgroundColor: '#0D2137' }]} />
        </View>
        <View style={[styles.guardianLeg, depthMd, { backgroundColor: character.armorColor }]}>
          <View style={[styles.guardianBoot, { backgroundColor: '#0D2137' }]} />
        </View>
      </View>
    </View>
  );

  const renderCharacter = () => {
    switch (character.key) {
      case 'warrior': return renderWarrior();
      case 'elf': return renderElf();
      case 'mage': return renderMage();
      case 'guardian': return renderGuardian();
      default: return renderWarrior();
    }
  };

  return (
    <View style={[styles.container, { width: size, height: size * 1.3 }]}>
      {/* Outer rim glow — wide soft halo behind character */}
      {showGlow && (
        <Animated.View style={[styles.glow, {
          backgroundColor: character.glowColor,
          opacity: Animated.multiply(glowAnim, 0.55),
          width: size * 1.05,
          height: size * 1.05,
          borderRadius: size * 0.525,
          top: size * 0.15,
          left: -size * 0.025,
          shadowColor: character.glowColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.9,
          shadowRadius: 30,
          elevation: 20,
        }]} />
      )}

      {/* Inner core glow — tighter, brighter */}
      {showGlow && (
        <Animated.View style={[styles.glow, {
          backgroundColor: character.glowColor,
          opacity: glowAnim,
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: size * 0.35,
          top: size * 0.3,
          left: size * 0.15,
        }]} />
      )}

      {/* Aura ring for equipped aura */}
      {equipped?.aura && (
        <Animated.View style={[styles.auraRing, {
          borderColor: character.glowColor,
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: size * 0.45,
          top: size * 0.2,
          left: size * 0.05,
          opacity: glowAnim,
        }]} />
      )}

      {/* Floating character */}
      <Animated.View style={{
        transform: [{ translateY: floatAnim }, { scale: pulseAnim }],
      }}>
        {render3D ? (
          <Character3D character={character} size={size} />
        ) : (
          renderCharacter()
        )}
      </Animated.View>

      {/* Level badge */}
      <View style={[styles.levelBadge, depthMd, { backgroundColor: character.glowColor }]}>
        <Text style={styles.levelText}>{level}</Text>
      </View>

      {/* Ground shadow — dark blob beneath feet */}
      <View style={[styles.groundShadow, {
        width: size * 0.55,
        height: size * 0.1,
        bottom: size * 0.02,
        left: size * 0.225,
      }]} />
      {/* Colored rim shadow glow */}
      <View style={[styles.shadow, {
        width: size * 0.4,
        height: size * 0.08,
        bottom: 0,
        left: size * 0.3,
        backgroundColor: character.glowColor,
      }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glow: {
    position: 'absolute',
  },
  auraRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  shadow: {
    position: 'absolute',
    borderRadius: 100,
    opacity: 0.3,
  },
  groundShadow: {
    position: 'absolute',
    borderRadius: 100,
    backgroundColor: '#000',
    opacity: 0.45,
    transform: [{ scaleY: 0.5 }],
  },
  levelBadge: {
    position: 'absolute',
    top: 0,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  levelText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
  },
  characterBase: {
    width: 120,
    height: 180,
    alignItems: 'center',
    position: 'relative',
  },

  // ===== WARRIOR STYLES =====
  helmet: {
    width: 50,
    height: 40,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  helmetVisor: {
    width: 30,
    height: 6,
    borderRadius: 3,
    marginBottom: 4,
  },
  hornLeft: {
    position: 'absolute',
    top: -8,
    left: 2,
    width: 8,
    height: 16,
    borderRadius: 4,
    transform: [{ rotate: '-20deg' }],
  },
  hornRight: {
    position: 'absolute',
    top: -8,
    right: 2,
    width: 8,
    height: 16,
    borderRadius: 4,
    transform: [{ rotate: '20deg' }],
  },
  eyeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    position: 'absolute',
    top: 22,
    left: 0,
    right: 0,
    zIndex: 3,
  },
  eye: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 5,
  },
  body: {
    width: 56,
    height: 50,
    borderRadius: 8,
    borderWidth: 2,
    marginTop: -4,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  chestPlate: {
    width: 20,
    height: 16,
    borderRadius: 4,
    marginBottom: 2,
  },
  belt: {
    width: 40,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    bottom: 6,
  },
  armLeft: {
    position: 'absolute',
    top: 42,
    left: 10,
    width: 18,
    height: 45,
    borderRadius: 8,
    zIndex: 0,
  },
  armRight: {
    position: 'absolute',
    top: 42,
    right: 10,
    width: 18,
    height: 45,
    borderRadius: 8,
    zIndex: 0,
  },
  gauntlet: {
    position: 'absolute',
    bottom: 0,
    width: 18,
    height: 16,
    borderRadius: 6,
  },
  sword: {
    position: 'absolute',
    bottom: -20,
    right: -4,
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  swordHandle: {
    position: 'absolute',
    bottom: 0,
    left: -4,
    width: 12,
    height: 4,
    borderRadius: 2,
  },
  legContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: -2,
  },
  leg: {
    width: 20,
    height: 35,
    borderRadius: 6,
  },
  boot: {
    position: 'absolute',
    bottom: 0,
    width: 22,
    height: 12,
    borderRadius: 6,
    left: -1,
  },

  // ===== ELF STYLES =====
  elfHead: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    zIndex: 2,
  },
  elfEarLeft: {
    position: 'absolute',
    top: 8,
    left: -10,
    width: 16,
    height: 8,
    borderRadius: 8,
    borderWidth: 1,
    transform: [{ rotate: '-30deg' }],
  },
  elfEarRight: {
    position: 'absolute',
    top: 8,
    right: -10,
    width: 16,
    height: 8,
    borderRadius: 8,
    borderWidth: 1,
    transform: [{ rotate: '30deg' }],
  },
  elfHair: {
    position: 'absolute',
    top: -6,
    width: 46,
    height: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  tiara: {
    position: 'absolute',
    top: 2,
    width: 30,
    height: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiaraGem: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  elfEye: {
    width: 5,
    height: 7,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 5,
    elevation: 5,
  },
  elfBody: {
    width: 44,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: -4,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  elfCape: {
    position: 'absolute',
    bottom: -10,
    width: 50,
    height: 30,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  elfGem: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: -8,
  },
  elfArmLeft: {
    position: 'absolute',
    top: 44,
    left: 16,
    width: 14,
    height: 42,
    borderRadius: 7,
    zIndex: 0,
  },
  elfArmRight: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 14,
    height: 42,
    borderRadius: 7,
    zIndex: 0,
  },
  elfBracer: {
    position: 'absolute',
    bottom: 4,
    width: 14,
    height: 12,
    borderRadius: 5,
  },
  bow: {
    position: 'absolute',
    bottom: -14,
    right: -8,
    width: 20,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderLeftWidth: 0,
    backgroundColor: 'transparent',
  },
  elfLeg: {
    width: 16,
    height: 34,
    borderRadius: 6,
  },
  elfBoot: {
    position: 'absolute',
    bottom: 0,
    width: 18,
    height: 10,
    borderRadius: 5,
    left: -1,
  },

  // ===== MAGE STYLES =====
  mageHat: {
    width: 60,
    height: 40,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    zIndex: 3,
  },
  mageHatTip: {
    position: 'absolute',
    top: -12,
    width: 10,
    height: 16,
    borderRadius: 5,
    transform: [{ rotate: '15deg' }],
  },
  mageHatBrim: {
    position: 'absolute',
    bottom: -4,
    width: 70,
    height: 8,
    borderRadius: 4,
  },
  mageFace: {
    width: 36,
    height: 28,
    borderRadius: 14,
    marginTop: -2,
    zIndex: 2,
  },
  mageEye: {
    width: 5,
    height: 5,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 5,
  },
  mageRobe: {
    width: 52,
    height: 58,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: -6,
    alignItems: 'center',
    zIndex: 1,
  },
  mageOrb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  robePattern1: {
    position: 'absolute',
    bottom: 14,
    left: 8,
    width: 36,
    height: 2,
    borderRadius: 1,
    opacity: 0.4,
  },
  robePattern2: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    width: 28,
    height: 2,
    borderRadius: 1,
    opacity: 0.3,
  },
  mageArmLeft: {
    position: 'absolute',
    top: 68,
    left: 14,
    width: 14,
    height: 38,
    borderRadius: 7,
    zIndex: 0,
  },
  mageArmRight: {
    position: 'absolute',
    top: 68,
    right: 14,
    width: 14,
    height: 38,
    borderRadius: 7,
    zIndex: 0,
  },
  mageSleeve: {
    width: 14,
    height: 18,
    borderRadius: 7,
  },
  staff: {
    position: 'absolute',
    bottom: -24,
    right: -4,
    width: 4,
    height: 60,
    borderRadius: 2,
  },
  staffOrb: {
    position: 'absolute',
    top: -10,
    left: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 10,
  },
  mageLeg: {
    width: 18,
    height: 20,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },

  // ===== GUARDIAN STYLES =====
  guardianHelmet: {
    width: 56,
    height: 44,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  guardianCrest: {
    position: 'absolute',
    top: -6,
    width: 8,
    height: 18,
    borderRadius: 4,
  },
  guardianVisor: {
    width: 40,
    height: 14,
    borderRadius: 4,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  guardianBody: {
    width: 68,
    height: 56,
    borderRadius: 10,
    borderWidth: 2,
    marginTop: -4,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  guardianChest: {
    width: 30,
    height: 3,
    borderRadius: 2,
    marginBottom: 4,
  },
  guardianCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  guardianArmLeft: {
    position: 'absolute',
    top: 44,
    left: 4,
    width: 22,
    height: 48,
    borderRadius: 10,
    zIndex: 0,
  },
  guardianArmRight: {
    position: 'absolute',
    top: 44,
    right: 4,
    width: 22,
    height: 48,
    borderRadius: 10,
    zIndex: 0,
  },
  guardianShoulder: {
    width: 22,
    height: 12,
    borderRadius: 6,
  },
  bigShield: {
    position: 'absolute',
    bottom: -10,
    left: -16,
    width: 36,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldEmblem: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  guardianLeg: {
    width: 24,
    height: 36,
    borderRadius: 8,
  },
  guardianBoot: {
    position: 'absolute',
    bottom: 0,
    width: 26,
    height: 14,
    borderRadius: 8,
    left: -1,
  },
});
