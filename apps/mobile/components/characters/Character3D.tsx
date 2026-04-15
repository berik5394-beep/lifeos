/**
 * Character3D — real 3D character renderer for LifeOS.
 *
 * Stack:
 *   - @react-three/fiber/native  (R3F's native entrypoint — uses expo-gl's GLView
 *     under the hood; do NOT import from '@react-three/fiber' root in Expo)
 *   - three                      (geometry + materials)
 *   - @react-three/drei/native   (optional helpers; reserved for future useGLTF)
 *
 * Current implementation renders a low-poly humanoid built from three.js
 * primitive geometries (capsules, spheres, cylinders, boxes, cones). This is
 * intentionally a PLACEHOLDER — no GLTF assets are bundled yet. The goal is to
 * get real perspective + lighting + depth so the characters stop looking like
 * stacked <View> shadows.
 *
 * How to swap in real GLTF assets later:
 *   1. Drop a .glb into apps/mobile/assets/models/<type>.glb
 *   2. Import `useGLTF` from '@react-three/drei/native'
 *   3. Inside a <Suspense> fallback, do:
 *        const { scene } = useGLTF(require('assets/models/warrior.glb'));
 *        return <primitive object={scene} />;
 *   4. For animated rigs add `useAnimations` and drive clips via useFrame.
 *
 * Known limitations:
 *   - No real shadow casting. Shadow maps on expo-gl / Metro are flaky and
 *     balloon the GL state machine; we fake depth with lighting contrast instead.
 *   - No post-processing. EffectComposer on native R3F has rough edges in SDK 54.
 *   - Single directional + ambient light. Intentional — more lights kill perf on
 *     low-end Android GPUs.
 *   - Animation is a simple rotating turntable. Full bone rigs come with GLTF.
 */

import React, { Suspense, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import type { CharacterConfig } from '../../constants/characters';

interface Character3DProps {
  character: CharacterConfig;
  size?: number;
  autoRotate?: boolean;
}

type CharacterKey = 'warrior' | 'elf' | 'mage' | 'guardian' | string;

interface SceneProps {
  character: CharacterConfig;
  autoRotate: boolean;
}

// Root group — holds the whole humanoid so we can spin the entire rig.
function CharacterRig({ character, autoRotate }: SceneProps) {
  const rootRef = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (autoRotate && rootRef.current) {
      rootRef.current.rotation.y += delta * 0.4;
    }
  });

  const body = character.bodyColor;
  const armor = character.armorColor;
  const accent = character.accentColor;
  const eye = character.eyeColor;

  // Materials — MeshStandardMaterial reacts to lighting so depth reads properly.
  const skinMat = <meshStandardMaterial color={body} roughness={0.55} metalness={0.05} />;
  const armorMat = <meshStandardMaterial color={armor} roughness={0.35} metalness={0.55} />;
  const accentMat = <meshStandardMaterial color={accent} roughness={0.3} metalness={0.4} />;
  const eyeMat = <meshStandardMaterial color={eye} emissive={eye} emissiveIntensity={0.6} />;

  return (
    <group ref={rootRef} position={[0, -0.6, 0]}>
      {/* Torso (armor) */}
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.5, 1.2, 8, 16]} />
        {armorMat}
      </mesh>

      {/* Head */}
      <mesh position={[0, 2.15, 0]}>
        <sphereGeometry args={[0.35, 24, 24]} />
        {skinMat}
      </mesh>

      {/* Eyes — emissive so they glow regardless of light angle */}
      <mesh position={[-0.13, 2.2, 0.3]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        {eyeMat}
      </mesh>
      <mesh position={[0.13, 2.2, 0.3]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        {eyeMat}
      </mesh>

      {/* Arms (capsules, rotated down along Z) */}
      <mesh position={[-0.75, 1.1, 0]} rotation={[0, 0, 0.15]}>
        <capsuleGeometry args={[0.17, 1.0, 6, 12]} />
        {armorMat}
      </mesh>
      <mesh position={[0.75, 1.1, 0]} rotation={[0, 0, -0.15]}>
        <capsuleGeometry args={[0.17, 1.0, 6, 12]} />
        {armorMat}
      </mesh>

      {/* Legs */}
      <mesh position={[-0.28, -0.15, 0]}>
        <capsuleGeometry args={[0.2, 1.0, 6, 12]} />
        {armorMat}
      </mesh>
      <mesh position={[0.28, -0.15, 0]}>
        <capsuleGeometry args={[0.2, 1.0, 6, 12]} />
        {armorMat}
      </mesh>

      {/* Class-specific props */}
      <ClassProps characterKey={character.key} accent={accent} armor={armor} glow={character.glowColor} />
    </group>
  );
}

interface ClassPropsArgs {
  characterKey: CharacterKey;
  accent: string;
  armor: string;
  glow: string;
}

function ClassProps({ characterKey, accent, armor, glow }: ClassPropsArgs) {
  switch (characterKey) {
    case 'warrior':
      return (
        <group>
          {/* Cylindrical helmet on top of head */}
          <mesh position={[0, 2.5, 0]}>
            <cylinderGeometry args={[0.37, 0.37, 0.25, 16]} />
            <meshStandardMaterial color={armor} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Helmet crest */}
          <mesh position={[0, 2.68, 0]}>
            <boxGeometry args={[0.08, 0.18, 0.5]} />
            <meshStandardMaterial color={accent} roughness={0.4} metalness={0.5} />
          </mesh>
          {/* Cone sword in right hand */}
          <mesh position={[0.95, 0.9, 0]} rotation={[0, 0, -Math.PI / 2.2]}>
            <coneGeometry args={[0.09, 1.4, 12]} />
            <meshStandardMaterial color="#E5E7EB" roughness={0.2} metalness={0.9} />
          </mesh>
          {/* Box shield in left hand */}
          <mesh position={[-1.0, 1.0, 0.1]}>
            <boxGeometry args={[0.15, 0.9, 0.6]} />
            <meshStandardMaterial color={accent} roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      );

    case 'elf':
      return (
        <group>
          {/* Pointed-cone hood */}
          <mesh position={[0, 2.55, 0]}>
            <coneGeometry args={[0.4, 0.55, 16]} />
            <meshStandardMaterial color={accent} roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Thin bow — torus tilted */}
          <mesh position={[0.95, 1.1, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.55, 0.035, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#8B5A2B" roughness={0.7} metalness={0.2} />
          </mesh>
          {/* Bow string */}
          <mesh position={[0.95, 1.1, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 1.1, 6]} />
            <meshStandardMaterial color="#F8FAFC" roughness={0.9} metalness={0} />
          </mesh>
        </group>
      );

    case 'mage':
      return (
        <group>
          {/* Wide cone hat */}
          <mesh position={[0, 2.75, 0]}>
            <coneGeometry args={[0.5, 0.9, 16]} />
            <meshStandardMaterial color={accent} roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Hat brim */}
          <mesh position={[0, 2.35, 0]}>
            <cylinderGeometry args={[0.55, 0.55, 0.06, 16]} />
            <meshStandardMaterial color={accent} roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Staff — cylinder */}
          <mesh position={[0.95, 0.8, 0]} rotation={[0, 0, 0.05]}>
            <cylinderGeometry args={[0.045, 0.045, 2.2, 12]} />
            <meshStandardMaterial color="#5A3A22" roughness={0.8} metalness={0.1} />
          </mesh>
          {/* Glowing orb on staff */}
          <mesh position={[0.96, 2.0, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={1.2} roughness={0.1} />
          </mesh>
        </group>
      );

    case 'guardian':
      return (
        <group>
          {/* Rounded helmet */}
          <mesh position={[0, 2.45, 0]}>
            <sphereGeometry args={[0.4, 16, 16, 0, Math.PI * 2, 0, Math.PI / 1.8]} />
            <meshStandardMaterial color={armor} roughness={0.25} metalness={0.85} />
          </mesh>
          {/* Big round shield */}
          <mesh position={[-1.05, 1.1, 0.15]} rotation={[0, Math.PI / 2, 0]}>
            <cylinderGeometry args={[0.65, 0.65, 0.12, 24]} />
            <meshStandardMaterial color={accent} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Shield boss */}
          <mesh position={[-1.13, 1.1, 0.15]} rotation={[0, Math.PI / 2, 0]}>
            <sphereGeometry args={[0.14, 16, 16]} />
            <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.5} roughness={0.2} metalness={0.9} />
          </mesh>
        </group>
      );

    default:
      return null;
  }
}

export function Character3D({ character, size = 200, autoRotate = true }: Character3DProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Canvas
        camera={{ position: [0, 1.2, 5.2], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={styles.canvas}
      >
        {/* Lighting — ambient fill + directional key light from upper-front */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 4]} intensity={1.0} />
        {/* Rim light from behind to separate silhouette */}
        <directionalLight position={[-2, 2, -3]} intensity={0.35} color={character.glowColor} />

        <Suspense fallback={null}>
          <CharacterRig character={character} autoRotate={autoRotate} />
        </Suspense>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
  },
  canvas: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default Character3D;
