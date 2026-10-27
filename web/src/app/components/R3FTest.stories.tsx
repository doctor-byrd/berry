// web/src/app/components/R3FTest.stories.tsx
//
// DESIGN NOTES — every asset is generated at runtime in JS. Nothing is
// fetched over the network (no Environment HDR presets, no Lightformer CDN
// assets, no external textures/models/fonts).
//   - Lighting: plain <ambientLight> + two <directionalLight>s + a
//     <pointLight> accent, plus an in-scene emissive "sun" for visual depth.
//   - Grounding: drei <ContactShadows> (render-target based, zero assets).
//   - Motion: drei <Float> (pure math) + useFrame rotation.
//   - Interaction: raycasted hover/click handled by R3F pointer events.
//
// Storybook glob picks this up automatically (web/.storybook/main.ts), and the
// custom preview.jsx decorator routes it through "MODE A" (plain React), so
// Pixi is fully bypassed.

import React, { useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Mesh, Group } from 'three';
import { OrbitControls, ContactShadows, Float, Grid } from '@react-three/drei';

// ---------- Tunable props (drive the Controls panel via argTypes) ----------

interface R3FTestProps {
  knotColor: string;
  metalness: number;
  roughness: number;
  autoRotate: boolean;
  animate: boolean;
  showGrid: boolean;
  showContactShadows: boolean;
  wireframe: boolean;
}

// ---------- Scene pieces (all procedural) ----------

function SpinningKnot({
  color,
  metalness,
  roughness,
  spin,
  wireframe,
}: {
  color: string;
  metalness: number;
  roughness: number;
  spin: boolean;
  wireframe: boolean;
}) {
  const mesh = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  useFrame((_, delta) => {
    if (!mesh.current || !spin) return;
    mesh.current.rotation.x += delta * 0.4;
    mesh.current.rotation.y += delta * 0.55;
  });

  return (
    <Float speed={hovered ? 6 : 2} rotationIntensity={0.4} floatIntensity={0.8}>
      <mesh
        ref={mesh}
        scale={active ? 1.25 : hovered ? 1.1 : 1}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); setActive(false); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); setActive((v) => !v); }}
      >
        <torusKnotGeometry args={[1, 0.32, 220, 36]} />
        <meshStandardMaterial
          color={active ? '#ffcf6b' : color}
          metalness={metalness}
          roughness={roughness}
          emissive={hovered ? '#223355' : '#000000'}
          wireframe={wireframe}
        />
      </mesh>
    </Float>
  );
}

function OrbitingSpheres() {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.getElapsedTime() * 0.35;
  });
  const positions: [number, number, number][] = [
    [2.6, 0.4, 0], [-2.6, -0.4, 0], [0, 0.4, 2.6], [0, -0.4, -2.6],
  ];
  return (
    <group ref={group}>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.18, 24, 24]} />
          <meshStandardMaterial color={['#f97316', '#22d3ee', '#a78bfa', '#4ade80'][i]} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

// In-scene emissive "sun" — replaces any need for an environment map.
function EmissiveSun() {
  return (
    <mesh position={[-5, 4, -6]}>
      <sphereGeometry args={[0.7, 32, 32]} />
      <meshBasicMaterial color="#ffd27a" toneMapped={false} />
    </mesh>
  );
}

// ---------- Story wrapper ----------

const R3FTestScene = ({
  knotColor,
  metalness,
  roughness,
  autoRotate,
  animate,
  showGrid,
  showContactShadows,
  wireframe,
}: R3FTestProps) => (
  <div style={{ width: '100vw', height: '100vh', background: 'linear-gradient(#0b1020, #1a2340)' }}>
    <Canvas camera={{ position: [4, 2.5, 6], fov: 45 }} dpr={[1, 2]}>
      {/* --- Zero-asset lighting rig --- */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} />
      <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#8ab4ff" />
      <pointLight position={[-5, 4, -6]} intensity={40} color="#ffd27a" distance={20} decay={2} />

      <SpinningKnot
        color={knotColor}
        metalness={metalness}
        roughness={roughness}
        spin={animate}
        wireframe={wireframe}
      />
      <OrbitingSpheres />
      <EmissiveSun />

      {showGrid && (
        <Grid
          position={[0, -1.6, 0]}
          args={[20, 20]}
          cellSize={0.6}
          cellThickness={0.6}
          sectionSize={3}
          sectionThickness={1.2}
          cellColor="#31456e"
          sectionColor="#4c6fff"
          fadeDistance={26}
          infiniteGrid
        />
      )}
      {showContactShadows && (
        <ContactShadows position={[0, -1.58, 0]} opacity={0.55} scale={14} blur={2.4} far={4} />
      )}

      <OrbitControls makeDefault enablePan={false} autoRotate={autoRotate} autoRotateSpeed={1.2} />
    </Canvas>
  </div>
);

// ---------- Meta / stories ----------

const meta: Meta<typeof R3FTestScene> = {
  title: 'Web/ThreeJS/R3FTest',
  component: R3FTestScene,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  argTypes: {
    knotColor: { control: 'color' },
    metalness: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    roughness: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    autoRotate: { control: 'boolean' },
    animate: { control: 'boolean' },
    showGrid: { control: 'boolean' },
    showContactShadows: { control: 'boolean' },
    wireframe: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof R3FTestScene>;

export const Default: Story = {
  args: {
    knotColor: '#ff5b5b',
    metalness: 0.35,
    roughness: 0.25,
    autoRotate: false,
    animate: true,
    showGrid: true,
    showContactShadows: true,
    wireframe: false,
  },
};

/** Bare-bones variant: one light, one mesh — fastest smoke test of the WebGL pipeline. */
export const Minimal: Story = {
  args: { ...Default.args, autoRotate: true, showGrid: false, showContactShadows: false },
};

/** Material-debug variant: geometry topology visible, high metal for specular check. */
export const Wireframe: Story = {
  args: { ...Default.args, wireframe: true, metalness: 0.9, roughness: 0.1, knotColor: '#22d3ee' },
};