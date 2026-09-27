/**
 * Процедурные 3D-модели роботов по виду (kinds.ts). Размеры деталей считаются в метрах от габаритов
 * карточки: модель в превью совпадает с введёнными длиной, шириной и высотой.
 * Оси: X — длина (перед робота смотрит в +X), Y — высота, Z — ширина. Пол на высоте 0.
 */

import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useMemo, useRef, type ComponentType } from "react";
import { MeshStandardMaterial, SphereGeometry, type Group } from "three";

import { geometries, material, seededRandom } from "../shared";
import type { RobotKind, Size } from "./kinds";

type V3 = [number, number, number];
export type Tone = "default" | "highlight" | "muted";

const TONES: Record<Tone, { body: string; shell: string; accent: string }> = {
  default: { body: "#a3c1ec", shell: "#cfe0f6", accent: "#6a97d8" },
  highlight: { body: "#79a3e6", shell: "#b2cdf3", accent: "#2f6ddb" },
  muted: { body: "#c9d9f0", shell: "#dde8f8", accent: "#a9c3e8" },
};

const FIXED = {
  dark: "#34507a",
  sensor: "#1e3354",
  trim: "#eef4fd",
  tire: "#3b5479",
  pallet: "#b9cfee",
  boxes: ["#f3f7fe", "#e2ecfa", "#d3e2f7"],
};

const glow = new MeshStandardMaterial({ color: "#8cc0ff", emissive: "#3d86ff", emissiveIntensity: 1.1, roughness: 0.4 });
const rotorDisc = new MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.3, depthWrite: false });
const sphere = new SphereGeometry(1, 28, 18);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const ModelContext = createContext({ colors: TONES.default, animate: false });
const useModel = () => useContext(ModelContext);

function Part({ p, s, c, rounded = true, rot }: { p: V3; s: V3; c: string; rounded?: boolean; rot?: V3 }) {
  return (
    <mesh
      geometry={rounded ? geometries.roundedBox : geometries.box}
      material={material(c)}
      position={p}
      scale={s}
      rotation={rot}
      castShadow
      receiveShadow
    />
  );
}

function Glow({ p, s }: { p: V3; s: V3 }) {
  return <mesh geometry={geometries.box} material={glow} position={p} scale={s} />;
}

function Cyl({ p, r, len, c, axis = "y" }: { p: V3; r: number; len: number; c: string; axis?: "x" | "y" | "z" }) {
  const rotation: V3 = axis === "x" ? [0, 0, Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return (
    <mesh
      geometry={geometries.cylinder}
      material={material(c)}
      position={p}
      rotation={rotation}
      scale={[r, len, r]}
      castShadow
      receiveShadow
    />
  );
}

function Ball({ p, s, c }: { p: V3; s: V3; c: string }) {
  return <mesh geometry={sphere} material={material(c)} position={p} scale={s} castShadow receiveShadow />;
}

function Wheel({ x, z, r, width, y }: { x: number; z: number; r: number; width: number; y?: number }) {
  return (
    <group position={[x, y ?? r, z]}>
      <Cyl p={[0, 0, 0]} r={r} len={width} c={FIXED.tire} axis="z" />
      <Cyl p={[0, 0, Math.sign(z) * width * 0.04]} r={r * 0.52} len={width} c={FIXED.trim} axis="z" />
    </group>
  );
}

/** Лидар с вращающейся головкой. */
function Lidar({ p, r }: { p: V3; r: number }) {
  const head = useRef<Group>(null);
  const { animate } = useModel();
  useFrame((_, delta) => {
    if (animate && head.current) head.current.rotation.y += delta * 2.6;
  });
  return (
    <group position={p}>
      <Cyl p={[0, r * 0.3, 0]} r={r} len={r * 0.6} c={FIXED.sensor} />
      <group ref={head} position={[0, r * 0.75, 0]}>
        <Cyl p={[0, 0, 0]} r={r * 0.8} len={r * 0.35} c={FIXED.dark} />
        <Glow p={[r * 0.72, 0, 0]} s={[r * 0.18, r * 0.2, r * 0.6]} />
      </group>
    </group>
  );
}

function Pallet({ x, y, l, w, load }: { x: number; y: number; l: number; w: number; load: number }) {
  const deck = 0.13;
  return (
    <group position={[x, y, 0]}>
      <Part p={[0, deck / 2, 0]} s={[l, deck, w]} c={FIXED.pallet} rounded={false} />
      {[-1, 1].flatMap((i) =>
        [-1, 1].map((j) => (
          <Part
            key={`${i}${j}`}
            p={[i * l * 0.24, deck + load / 2, j * w * 0.24]}
            s={[l * 0.46, load, w * 0.46]}
            c={FIXED.boxes[(i + j + 2) % 3]}
          />
        )),
      )}
    </group>
  );
}

function SideGlow({ x = 0, y, l, w }: { x?: number; y: number; l: number; w: number }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <Glow key={side} p={[x, y, side * (w / 2 + 0.003)]} s={[l, Math.max(0.008, l * 0.02), 0.006]} />
      ))}
    </>
  );
}

// ---------- модели ----------

function Platform({ l, w, h }: Size) {
  const { colors } = useModel();
  const clearance = clamp(h * 0.14, 0.02, 0.08);
  const plate = clamp(h * 0.1, 0.012, 0.05);
  const bodyH = Math.max(0.04, h - clearance - plate);
  const r = clamp(Math.min(h * 0.24, l * 0.07), 0.025, 0.12);
  const wx = l / 2 - r * 1.8;
  const wz = w / 2 - Math.min(0.05, w * 0.06);
  return (
    <>
      <Part p={[0, clearance + bodyH / 2, 0]} s={[l, bodyH, w]} c={colors.body} />
      <Part p={[0, h - plate / 2, 0]} s={[l * 0.93, plate, w * 0.88]} c={FIXED.trim} />
      <Part p={[l / 2 - 0.004, clearance + bodyH * 0.55, 0]} s={[0.014, bodyH * 0.3, w * 0.66]} c={FIXED.sensor} rounded={false} />
      <Part p={[-l / 2 + 0.004, clearance + bodyH * 0.55, 0]} s={[0.014, bodyH * 0.3, w * 0.4]} c={FIXED.sensor} rounded={false} />
      <SideGlow y={clearance + bodyH * 0.32} l={l * 0.62} w={w} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Wheel key={`${sx}${sz}`} x={sx * wx} z={sz * wz} r={r} width={Math.min(0.06, w * 0.08)} />),
      )}
    </>
  );
}

function Forklift({ l, w, h }: Size) {
  const { colors } = useModel();
  const base = 0.07;
  const bodyL = l * 0.5;
  const bodyH = clamp(h * 0.42, 0.35, 1.5);
  const bodyX = -l / 2 + bodyL / 2;
  const mastX = -l / 2 + bodyL + 0.05;
  const forkL = Math.max(0.3, l / 2 - mastX - 0.06);
  const forkX = mastX + 0.06 + forkL / 2;
  const wheelR = clamp(bodyH * 0.2, 0.08, 0.28);
  const load = clamp(h * 0.2, 0.2, 0.9);
  return (
    <>
      <Part p={[bodyX, base + bodyH / 2, 0]} s={[bodyL, bodyH, w]} c={colors.body} />
      <Part p={[bodyX - bodyL * 0.12, base + bodyH + 0.025, 0]} s={[bodyL * 0.55, 0.05, w * 0.78]} c={FIXED.trim} />
      <SideGlow x={bodyX} y={base + bodyH * 0.72} l={bodyL * 0.7} w={w} />
      <Lidar p={[bodyX + bodyL * 0.28, base + bodyH + 0.03, 0]} r={clamp(w * 0.06, 0.035, 0.07)} />
      {[-1, 1].map((side) => (
        <Part key={side} p={[mastX, h / 2, side * w * 0.3]} s={[0.07, h, 0.08]} c={colors.accent} rounded={false} />
      ))}
      <Part p={[mastX, h - 0.035, 0]} s={[0.07, 0.07, w * 0.68]} c={colors.accent} rounded={false} />
      <Part p={[mastX + 0.045, 0.1 + load / 2, 0]} s={[0.04, load + 0.1, w * 0.62]} c={FIXED.dark} rounded={false} />
      {[-1, 1].map((side) => (
        <Part key={`fork${side}`} p={[forkX, 0.05, side * w * 0.19]} s={[forkL, 0.04, 0.11]} c={FIXED.dark} rounded={false} />
      ))}
      <Pallet x={forkX} y={0.07} l={Math.min(forkL * 0.95, 1.2)} w={Math.min(w * 0.95, 0.8)} load={load} />
      {[-1, 1].map((side) => (
        <Wheel key={`rear${side}`} x={bodyX - bodyL * 0.15} z={side * (w / 2 - 0.06)} r={wheelR} width={0.1} />
      ))}
      {[-1, 1].map((side) => (
        <Wheel key={`roller${side}`} x={forkX + forkL * 0.36} z={side * w * 0.19} r={0.035} width={0.07} />
      ))}
    </>
  );
}

function Tug({ l, w, h }: Size) {
  const { colors } = useModel();
  const clearance = clamp(h * 0.1, 0.03, 0.1);
  const bodyL = l * 0.86;
  const bodyH = h * 0.88 - clearance;
  const bx = l / 2 - bodyL / 2;
  const r = clamp(h * 0.14, 0.05, 0.16);
  return (
    <>
      <Part p={[bx, clearance + bodyH / 2, 0]} s={[bodyL, bodyH, w]} c={colors.body} />
      <Part p={[bx - bodyL * 0.05, clearance + bodyH + h * 0.05, 0]} s={[bodyL * 0.7, h * 0.1, w * 0.82]} c={colors.shell} />
      <Part p={[l / 2 - 0.004, clearance + bodyH * 0.5, 0]} s={[0.014, bodyH * 0.28, w * 0.7]} c={FIXED.sensor} rounded={false} />
      <SideGlow x={bx} y={clearance + bodyH * 0.35} l={bodyL * 0.6} w={w} />
      <mesh geometry={geometries.cylinder} material={glow} position={[bx + bodyL * 0.25, h - 0.01, 0]} scale={[0.03, 0.04, 0.03]} />
      <Part p={[-l / 2 + (l - bodyL) / 2, clearance + 0.1, 0]} s={[l - bodyL + 0.05, 0.05, 0.14]} c={FIXED.dark} rounded={false} />
      <Cyl p={[-l / 2 + 0.03, clearance + 0.14, 0]} r={0.018} len={0.1} c={colors.accent} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Wheel key={`${sx}${sz}`} x={bx + sx * bodyL * 0.32} z={sz * (w / 2 - 0.035)} r={r} width={0.07} />
        )),
      )}
    </>
  );
}

function Cleaner({ l, w, h }: Size) {
  const { colors } = useModel();
  const base = clamp(h * 0.06, 0.03, 0.08);
  const bodyH = h * 0.6;
  const tankH = h - base - bodyH;
  const brushR = clamp(h * 0.05, 0.03, 0.07);
  return (
    <>
      <Part p={[0, base + bodyH / 2, 0]} s={[l, bodyH, w]} c={colors.body} />
      <Part p={[-l * 0.18, base + bodyH + tankH / 2, 0]} s={[l * 0.56, tankH, w * 0.84]} c={colors.shell} />
      <Part p={[-l * 0.18, h - 0.01, 0]} s={[l * 0.3, 0.02, w * 0.4]} c={FIXED.trim} />
      <Cyl p={[l / 2 - brushR * 0.8, brushR, 0]} r={brushR} len={w * 0.86} c={colors.accent} axis="z" />
      <Part p={[-l / 2 - 0.01, 0.02, 0]} s={[0.04, 0.03, w * 1.06]} c={FIXED.dark} rounded={false} />
      <Part p={[l / 2 - 0.02, base + bodyH * 0.78, 0]} s={[0.03, h * 0.07, w * 0.46]} c={FIXED.sensor} rounded={false} />
      <Glow p={[l * 0.22, base + bodyH + 0.004, 0]} s={[l * 0.3, 0.008, w * 0.1]} />
      <SideGlow y={base + bodyH * 0.4} l={l * 0.5} w={w} />
    </>
  );
}

function Delivery({ l, w, h }: Size) {
  const { colors } = useModel();
  const baseH = h * 0.13;
  const cabinetH = h * 0.6;
  const cabinetY = baseH + 0.02;
  const headH = h - cabinetY - cabinetH;
  return (
    <>
      <Part p={[0, 0.02 + baseH / 2, 0]} s={[l, baseH, w]} c={colors.accent} />
      <Part p={[0, cabinetY + cabinetH / 2, 0]} s={[l * 0.9, cabinetH, w * 0.9]} c={colors.body} />
      {[0, 1, 2].map((i) => (
        <group key={i}>
          <Part p={[l * 0.45 + 0.004, cabinetY + cabinetH * (0.18 + i * 0.31), 0]} s={[0.012, cabinetH * 0.26, w * 0.74]} c={colors.shell} rounded={false} />
          <Glow p={[l * 0.45 + 0.012, cabinetY + cabinetH * (0.27 + i * 0.31), 0]} s={[0.006, 0.012, w * 0.22]} />
        </group>
      ))}
      <Part p={[0, cabinetY + cabinetH + headH / 2, 0]} s={[l * 0.74, headH, w * 0.8]} c={colors.shell} />
      <Part p={[l * 0.37 + 0.003, cabinetY + cabinetH + headH * 0.5, 0]} s={[0.01, headH * 0.62, w * 0.58]} c={FIXED.sensor} rounded={false} />
      {[-1, 1].map((side) => (
        <Glow key={side} p={[l * 0.37 + 0.01, cabinetY + cabinetH + headH * 0.55, side * w * 0.12]} s={[0.006, headH * 0.14, w * 0.08]} />
      ))}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Wheel key={`${sx}${sz}`} x={sx * l * 0.3} z={sz * w * 0.36} r={0.035} width={0.04} />),
      )}
    </>
  );
}

function Security({ l, w, h }: Size) {
  const { colors } = useModel();
  const r = Math.min(l, w) / 2;
  return (
    <>
      <Cyl p={[0, h * 0.07, 0]} r={r} len={h * 0.14} c={colors.accent} />
      <Cyl p={[0, h * 0.42, 0]} r={r * 0.86} len={h * 0.56} c={colors.body} />
      <mesh geometry={geometries.cylinder} material={glow} position={[0, h * 0.5, 0]} scale={[r * 0.875, h * 0.018, r * 0.875]} />
      <Cyl p={[0, h * 0.72, 0]} r={r * 0.74} len={h * 0.08} c={FIXED.sensor} />
      <Ball p={[0, h * 0.78, 0]} s={[r * 0.72, h * 0.2, r * 0.72]} c={colors.shell} />
      <mesh geometry={geometries.cylinder} material={glow} position={[0, h * 0.985, 0]} scale={[r * 0.12, h * 0.03, r * 0.12]} />
    </>
  );
}

function Inventory({ l, w, h }: Size) {
  const { colors } = useModel();
  const baseH = clamp(h * 0.14, 0.15, 0.4);
  const mastX = -l * 0.1;
  return (
    <>
      <Part p={[0, 0.03 + baseH / 2, 0]} s={[l, baseH, w]} c={colors.body} />
      <SideGlow y={0.03 + baseH * 0.4} l={l * 0.6} w={w} />
      <Part p={[mastX, (baseH + h) / 2, 0]} s={[0.08, h - baseH - 0.03, 0.1]} c={colors.accent} rounded={false} />
      {[0.38, 0.62, 0.86].map((k) => (
        <group key={k}>
          <Part p={[mastX + 0.03, h * k, 0]} s={[0.12, 0.08, w * 0.46]} c={FIXED.sensor} />
          {[-1, 1].map((side) => (
            <Glow key={side} p={[mastX + 0.03, h * k, side * (w * 0.23 + 0.003)]} s={[0.05, 0.03, 0.006]} />
          ))}
        </group>
      ))}
      <mesh geometry={geometries.cylinder} material={glow} position={[mastX, h, 0]} scale={[0.04, 0.03, 0.04]} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Wheel key={`${sx}${sz}`} x={sx * l * 0.34} z={sz * (w / 2 - 0.03)} r={0.05} width={0.05} />),
      )}
    </>
  );
}

function Truck({ l, w, h }: Size) {
  const { colors } = useModel();
  const wheelR = clamp(h * 0.19, 0.14, 0.55);
  const chassisY = wheelR * 1.05;
  const cabL = clamp(l * 0.22, 0.6, 2.2);
  const cabBottom = chassisY * 0.9;
  const cabH = h - cabBottom;
  const cargoL = l - cabL - 0.08;
  const cargoBottom = chassisY * 1.2;
  const cargoH = h * 0.92 - cargoBottom;
  const wz = w / 2 - wheelR * 0.35;
  const axles = [l / 2 - cabL * 0.5, -l / 2 + wheelR * 1.6, -l / 2 + wheelR * 3.9];
  return (
    <>
      <Part p={[0, chassisY, 0]} s={[l * 0.96, wheelR * 0.45, w * 0.8]} c={FIXED.dark} rounded={false} />
      <Part p={[l / 2 - cabL / 2, cabBottom + cabH / 2, 0]} s={[cabL, cabH, w * 0.96]} c={colors.body} />
      <Part p={[l / 2 + 0.004, cabBottom + cabH * 0.68, 0]} s={[0.02, cabH * 0.34, w * 0.8]} c={FIXED.sensor} rounded={false} />
      <Glow p={[l / 2 + 0.006, cabBottom + cabH * 0.3, 0]} s={[0.01, 0.04, w * 0.7]} />
      <Lidar p={[l / 2 - cabL * 0.4, h, 0]} r={clamp(w * 0.05, 0.06, 0.12)} />
      <Part p={[-l / 2 + cargoL / 2, cargoBottom + cargoH / 2, 0]} s={[cargoL, cargoH, w]} c={colors.shell} />
      <SideGlow x={-l / 2 + cargoL / 2} y={cargoBottom + cargoH * 0.12} l={cargoL * 0.9} w={w} />
      {axles.flatMap((x) =>
        [-1, 1].map((side) => <Wheel key={`${x}${side}`} x={x} z={side * wz} r={wheelR} width={wheelR * 0.6} />),
      )}
    </>
  );
}

function Tractor({ l, w, h }: Size) {
  const { colors } = useModel();
  const rearR = clamp(h * 0.3, 0.3, 1.0);
  const frontR = rearR * 0.6;
  const tyre = clamp(w * 0.2, 0.2, 0.6);
  const cabX = -l * 0.16;
  return (
    <>
      <Part p={[l * 0.12, frontR * 1.1 + h * 0.15, 0]} s={[l * 0.62, h * 0.3, w * 0.46]} c={colors.body} />
      <Part p={[cabX, h * 0.58, 0]} s={[l * 0.34, h * 0.42, w * 0.58]} c={colors.shell} />
      <Part p={[cabX + l * 0.17 + 0.004, h * 0.62, 0]} s={[0.02, h * 0.28, w * 0.5]} c={FIXED.sensor} rounded={false} />
      <Part p={[cabX, h - 0.025, 0]} s={[l * 0.38, 0.05, w * 0.64]} c={colors.body} />
      <Lidar p={[cabX, h, 0]} r={clamp(w * 0.04, 0.06, 0.1)} />
      <Glow p={[l * 0.43 + 0.004, frontR * 1.1 + h * 0.2, 0]} s={[0.01, 0.05, w * 0.3]} />
      {[-1, 1].map((side) => (
        <Wheel key={`r${side}`} x={-l * 0.22} z={side * (w / 2 - tyre / 2)} r={rearR} width={tyre} />
      ))}
      {[-1, 1].map((side) => (
        <Wheel key={`f${side}`} x={l * 0.32} z={side * w * 0.36} r={frontR} width={tyre * 0.7} />
      ))}
    </>
  );
}

function Storage({ l, w, h }: Size) {
  const { colors } = useModel();
  const nx = clamp(Math.round(l / 0.55), 3, 9);
  const nz = clamp(Math.round(w / 0.5), 2, 7);
  const cx = l / nx;
  const cz = w / nz;
  const gridH = h * 0.86;
  const stacks = useMemo(() => {
    const rand = seededRandom(nx * 31 + nz);
    return Array.from({ length: nx * nz }, () => 0.45 + rand() * 0.5);
  }, [nx, nz]);
  const x = (i: number) => -l / 2 + cx * i;
  const z = (j: number) => -w / 2 + cz * j;
  const posts: [number, number][] = [];
  for (let i = 0; i <= nx; i++) posts.push([i, 0], [i, nz]);
  for (let j = 1; j < nz; j++) posts.push([0, j], [nx, j]);
  const robots: [number, number][] = [
    [1, Math.min(1, nz - 1)],
    [nx - 2, nz - 1],
  ];
  return (
    <>
      {stacks.map((k, index) => {
        const i = index % nx;
        const j = Math.floor(index / nx);
        const stack = gridH * k;
        return (
          <Part key={index} p={[x(i) + cx / 2, stack / 2, z(j) + cz / 2]} s={[cx * 0.86, stack, cz * 0.86]} c={FIXED.boxes[(i + j) % 3]} />
        );
      })}
      {posts.map(([i, j]) => (
        <Part key={`p${i}:${j}`} p={[x(i), gridH / 2, z(j)]} s={[0.04, gridH, 0.04]} c={colors.accent} rounded={false} />
      ))}
      {Array.from({ length: nx + 1 }, (_, i) => (
        <Part key={`rx${i}`} p={[x(i), gridH, 0]} s={[0.03, 0.03, w]} c={colors.accent} rounded={false} />
      ))}
      {Array.from({ length: nz + 1 }, (_, j) => (
        <Part key={`rz${j}`} p={[0, gridH, z(j)]} s={[l, 0.03, 0.03]} c={colors.accent} rounded={false} />
      ))}
      {robots.map(([i, j]) => (
        <group key={`r${i}:${j}`} position={[x(i) + cx / 2, gridH + 0.015, z(j) + cz / 2]}>
          <Part p={[0, h * 0.05, 0]} s={[cx * 0.92, h * 0.1, cz * 0.92]} c={colors.body} />
          <Glow p={[0, h * 0.1 + 0.003, 0]} s={[cx * 0.4, 0.006, cz * 0.12]} />
        </group>
      ))}
    </>
  );
}

function Arm({ l, w, h }: Size) {
  const { colors, animate } = useModel();
  const turret = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const baseR = clamp(Math.min(l, w) * 0.22, 0.08, 0.6);
  const baseH = h * 0.1;
  const shoulderY = h * 0.3;
  const upper = h * 0.46;
  const fore = h * 0.38;
  const thick = clamp(h * 0.075, 0.04, 0.3);
  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime;
    if (turret.current) turret.current.rotation.y = Math.sin(t * 0.45) * 0.9;
    if (shoulder.current) shoulder.current.rotation.z = -0.35 + Math.sin(t * 0.7) * 0.12;
    if (elbow.current) elbow.current.rotation.z = -1.35 + Math.sin(t * 0.7 + 1) * 0.2;
  });
  return (
    <>
      <Cyl p={[0, baseH / 2, 0]} r={baseR} len={baseH} c={colors.accent} />
      <group ref={turret}>
        <Cyl p={[0, (baseH + shoulderY) / 2, 0]} r={baseR * 0.7} len={shoulderY - baseH} c={colors.body} />
        <group ref={shoulder} position={[0, shoulderY, 0]} rotation-z={-0.35}>
          <Cyl p={[0, 0, 0]} r={thick * 0.9} len={thick * 2.4} c={colors.accent} axis="z" />
          <Part p={[0, upper / 2, 0]} s={[thick * 1.4, upper + thick, thick * 1.5]} c={colors.body} />
          <group ref={elbow} position={[0, upper, 0]} rotation-z={-1.35}>
            <Cyl p={[0, 0, 0]} r={thick * 0.75} len={thick * 2} c={colors.accent} axis="z" />
            <Part p={[0, fore / 2, 0]} s={[thick, fore, thick * 1.1]} c={colors.body} />
            <Cyl p={[0, fore, 0]} r={thick * 0.5} len={thick * 0.6} c={FIXED.dark} />
            {[-1, 1].map((side) => (
              <Part key={side} p={[side * thick * 0.35, fore + thick * 0.55, 0]} s={[thick * 0.18, thick * 0.7, thick * 0.6]} c={FIXED.dark} rounded={false} />
            ))}
            <Glow p={[0, fore * 0.5, thick * 0.56]} s={[thick * 0.3, fore * 0.4, 0.006]} />
          </group>
        </group>
      </group>
    </>
  );
}

function MobileArm({ l, w, h }: Size) {
  const baseH = h * 0.32;
  return (
    <>
      <Platform l={l} w={w} h={baseH} />
      <group position={[-l * 0.1, baseH, 0]}>
        <Arm l={l * 0.5} w={w * 0.5} h={h - baseH} />
      </group>
    </>
  );
}

function Humanoid({ h }: Size) {
  const { colors } = useModel();
  const s = h / 1.8;
  const body = material(colors.body);
  const shell = material(colors.shell);
  return (
    <group scale={s}>
      {[-0.1, 0.1].map((z) => (
        <mesh key={z} geometry={geometries.limb} material={body} position={[0, 0.41, z]} scale={[1.2, 1.1, 1.2]} castShadow />
      ))}
      <mesh geometry={geometries.torso} material={shell} position={[0, 1.12, 0]} scale={[0.85, 1, 1.1]} castShadow />
      <Glow p={[0.17, 1.22, 0]} s={[0.01, 0.06, 0.12]} />
      {[-0.29, 0.29].map((z) => (
        <mesh key={z} geometry={geometries.limb} material={body} position={[0, 1.13, z]} scale={[0.95, 0.85, 0.95]} castShadow />
      ))}
      <Ball p={[0, 1.64, 0]} s={[0.13, 0.14, 0.13]} c={colors.shell} />
      <Part p={[0.1, 1.65, 0]} s={[0.05, 0.05, 0.18]} c={FIXED.sensor} />
    </group>
  );
}

function Drone({ l, w, h }: Size) {
  const { colors, animate } = useModel();
  const rotors = useRef<(Group | null)[]>([]);
  const span = Math.max(l, w);
  const body = span * 0.26;
  const armY = h * 0.62;
  const rotorR = span * 0.17;
  const a = span / 2 - rotorR;
  useFrame((_, delta) => {
    if (!animate) return;
    rotors.current.forEach((rotor, i) => {
      if (rotor) rotor.rotation.y += delta * (i % 2 ? 24 : -24);
    });
  });
  const corners: [number, number][] = [
    [a, a],
    [-a, a],
    [-a, -a],
    [a, -a],
  ];
  return (
    <>
      <Part p={[0, h * 0.5, 0]} s={[body, h * 0.28, body * 0.8]} c={colors.body} />
      <Part p={[0, h * 0.66, 0]} s={[body * 0.7, h * 0.08, body * 0.55]} c={colors.shell} />
      {corners.map(([x, z], i) => (
        <group key={i}>
          <Part
            p={[x / 2, armY, z / 2]}
            s={[Math.hypot(x, z), h * 0.06, span * 0.035]}
            rot={[0, -Math.atan2(z, x), 0]}
            c={colors.accent}
            rounded={false}
          />
          <Cyl p={[x, armY + h * 0.04, z]} r={span * 0.03} len={h * 0.14} c={FIXED.dark} />
          <group
            ref={(group) => {
              rotors.current[i] = group;
            }}
            position={[x, armY + h * 0.12, z]}
          >
            <mesh geometry={geometries.cylinder} material={rotorDisc} scale={[rotorR, 0.004, rotorR]} />
            <Part p={[0, 0, 0]} s={[rotorR * 2, 0.008, rotorR * 0.14]} c={FIXED.trim} rounded={false} />
          </group>
          <Glow p={[x * 1.02, armY - h * 0.02, z * 1.02]} s={[0.02, 0.02, 0.02]} />
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part p={[0, 0.012, side * body * 0.45]} s={[body * 1.4, 0.02, 0.025]} c={FIXED.dark} rounded={false} />
          {[-1, 1].map((sx) => (
            <Part key={sx} p={[sx * body * 0.35, h * 0.2, side * body * 0.45]} s={[0.02, h * 0.36, 0.02]} c={FIXED.dark} rounded={false} />
          ))}
        </group>
      ))}
      <Ball p={[body * 0.3, h * 0.3, 0]} s={[h * 0.1, h * 0.1, h * 0.1]} c={FIXED.sensor} />
    </>
  );
}

function Plane({ l, w, h }: Size) {
  const { colors, animate } = useModel();
  const propeller = useRef<Group>(null);
  const r = clamp(h * 0.28, 0.03, 0.6);
  const fy = h * 0.55;
  useFrame((_, delta) => {
    if (animate && propeller.current) propeller.current.rotation.x += delta * 30;
  });
  return (
    <>
      <Cyl p={[0, fy, 0]} r={r} len={l * 0.8} c={colors.body} axis="x" />
      <Ball p={[l * 0.4, fy, 0]} s={[l * 0.1, r, r]} c={colors.body} />
      <Ball p={[-l * 0.4, fy, 0]} s={[l * 0.12, r * 0.7, r * 0.7]} c={colors.body} />
      <Part p={[l * 0.06, fy + r * 0.3, 0]} s={[l * 0.2, Math.max(0.02, h * 0.06), w]} c={colors.shell} />
      <Glow p={[l * 0.06, fy + r * 0.3, w / 2]} s={[l * 0.06, 0.02, 0.01]} />
      <Glow p={[l * 0.06, fy + r * 0.3, -w / 2]} s={[l * 0.06, 0.02, 0.01]} />
      <Part p={[-l * 0.42, fy + r * 0.2, 0]} s={[l * 0.1, 0.02, w * 0.3]} c={colors.shell} />
      <Part p={[-l * 0.42, fy + h * 0.2, 0]} s={[l * 0.12, h * 0.42, 0.02]} c={colors.shell} />
      <group ref={propeller} position={[l * 0.51, fy, 0]}>
        <Part p={[0, 0, 0]} s={[0.012, r * 2.6, r * 0.25]} c={FIXED.dark} rounded={false} />
      </group>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part p={[l * 0.1, (fy - r) / 2, side * w * 0.08]} s={[0.02, fy - r, 0.02]} c={FIXED.dark} rounded={false} />
          <Wheel x={l * 0.1} z={side * w * 0.08} r={Math.min(0.04, fy * 0.2)} width={0.02} />
        </group>
      ))}
    </>
  );
}

function Marine({ l, w, h }: Size) {
  const { colors } = useModel();
  const hullH = h * 0.42;
  const hullL = l * 0.82;
  const hullX = -l / 2 + hullL / 2;
  const bowSide = w / Math.SQRT2;
  return (
    <>
      <Part p={[hullX, hullH / 2, 0]} s={[hullL, hullH, w]} c={colors.body} />
      <Part p={[hullX + hullL / 2, hullH / 2, 0]} s={[bowSide, hullH, bowSide]} rot={[0, Math.PI / 4, 0]} c={colors.body} rounded={false} />
      <Part p={[hullX, hullH * 0.3, 0]} s={[hullL, hullH * 0.12, w * 1.005]} c={colors.accent} rounded={false} />
      <Part p={[-l * 0.05, hullH + h * 0.15, 0]} s={[l * 0.3, h * 0.3, w * 0.62]} c={colors.shell} />
      <Part p={[-l * 0.05 + l * 0.15 + 0.003, hullH + h * 0.2, 0]} s={[0.01, h * 0.1, w * 0.5]} c={FIXED.sensor} rounded={false} />
      <Part p={[-l * 0.12, hullH + h * 0.43, 0]} s={[0.04, h * 0.26, 0.04]} c={FIXED.dark} rounded={false} />
      <Ball p={[-l * 0.12, h * 0.95, 0]} s={[h * 0.06, h * 0.05, h * 0.06]} c={FIXED.trim} />
      <Glow p={[-l * 0.12, h * 0.88, 0]} s={[0.03, 0.03, 0.03]} />
    </>
  );
}

function Software() {
  const { colors } = useModel();
  return (
    <>
      <Part p={[0, 0.01, 0]} s={[0.26, 0.02, 0.18]} c={colors.accent} />
      <Part p={[-0.03, 0.12, 0]} s={[0.04, 0.2, 0.04]} c={colors.body} />
      <Part p={[-0.02, 0.36, 0]} s={[0.025, 0.32, 0.54]} c={colors.body} />
      <Part p={[-0.004, 0.36, 0]} s={[0.012, 0.28, 0.5]} c={FIXED.sensor} rounded={false} />
      {[0.44, 0.39, 0.34, 0.29].map((y, i) => (
        <Glow key={y} p={[0.004, y, -0.2 + (i % 2) * 0.05 + 0.08]} s={[0.004, 0.018, 0.14 + (i % 3) * 0.08]} />
      ))}
    </>
  );
}

function Generic({ l, w, h }: Size) {
  const { colors } = useModel();
  return (
    <>
      <Part p={[0, 0.04, 0]} s={[l * 0.96, 0.08, w * 0.96]} c={FIXED.dark} rounded={false} />
      <Part p={[0, 0.08 + (h - 0.08) * 0.44, 0]} s={[l, (h - 0.08) * 0.88, w]} c={colors.body} />
      <SideGlow y={h * 0.5} l={l * 0.6} w={w} />
      <Lidar p={[l * 0.2, h * 0.96, 0]} r={clamp(Math.min(l, w) * 0.08, 0.03, 0.12)} />
    </>
  );
}

const MODELS: Record<RobotKind, ComponentType<Size>> = {
  platform: Platform,
  forklift: Forklift,
  tug: Tug,
  cleaner: Cleaner,
  delivery: Delivery,
  security: Security,
  inventory: Inventory,
  truck: Truck,
  tractor: Tractor,
  storage: Storage,
  arm: Arm,
  mobileArm: MobileArm,
  humanoid: Humanoid,
  drone: Drone,
  plane: Plane,
  marine: Marine,
  software: Software,
  generic: Generic,
};

interface RobotModelProps {
  kind: RobotKind;
  size: Size;
  tone?: Tone;
  animate?: boolean;
}

export function RobotModel({ kind, size, tone = "default", animate = false }: RobotModelProps) {
  const Model = MODELS[kind];
  const context = useMemo(() => ({ colors: TONES[tone], animate }), [tone, animate]);
  return (
    <ModelContext.Provider value={context}>
      <Model {...size} />
    </ModelContext.Provider>
  );
}

/** Человек ростом ≈1,8 м рядом с роботом — ориентир масштаба. */
export function ScaleFigure({ x, z = 0, rotation = 0 }: { x: number; z?: number; rotation?: number }) {
  const skin = material("#b4c8e6");
  return (
    <group position={[x, 0, z]} rotation-y={rotation}>
      {[-0.1, 0.1].map((dx) => (
        <mesh key={dx} geometry={geometries.limb} material={skin} position={[dx, 0.41, 0]} scale={[1.1, 1.08, 1.1]} castShadow />
      ))}
      <mesh geometry={geometries.torso} material={skin} position={[0, 1.12, 0]} castShadow />
      {[-0.27, 0.27].map((dx) => (
        <mesh key={dx} geometry={geometries.limb} material={skin} position={[dx, 1.16, 0]} scale={[0.85, 0.82, 0.85]} castShadow />
      ))}
      <mesh geometry={geometries.head} material={material("#c6d6ee")} position={[0, 1.68, 0]} castShadow />
    </group>
  );
}

/** Контур пятна застройки робота на полу: длина × ширина. */
export function Footprint({ l, w, color = "#5d8fdb" }: { l: number; w: number; color?: string }) {
  const t = Math.max(0.01, Math.max(l, w) * 0.01);
  const edge = material(color);
  return (
    <group position={[0, 0.002, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={`x${side}`} geometry={geometries.box} material={edge} position={[0, 0, side * (w / 2 + t)]} scale={[l + t * 4, 0.002, t]} />
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`z${side}`} geometry={geometries.box} material={edge} position={[side * (l / 2 + t), 0, 0]} scale={[t, 0.002, w + t * 4]} />
      ))}
    </group>
  );
}
