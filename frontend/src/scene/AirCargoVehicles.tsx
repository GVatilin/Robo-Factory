import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
  type InstancedMesh,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { geometries } from "./shared";

type Vec3 = [number, number, number];
type Part = {
  geometry?: BufferGeometry;
  position: Vec3;
  scale: Vec3;
  color: string;
  rotation?: Vec3;
};

const box = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(1, 1, 1, 12);
const sphere = new SphereGeometry(1, 10, 6);
const matte = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
const colors = {
  body: "#a3c1ec",
  shell: "#cfe0f6",
  accent: "#6a97d8",
  dark: "#34507a",
  sensor: "#1e3354",
  trim: "#eef4fd",
  light: "#8cc0ff",
};

// Bake static pieces once. Vertex colors retain their palette in one draw call.
function bake(parts: Part[]): BufferGeometry {
  const transform = new Object3D();
  const pieces = parts.map((part) => {
    const source = part.geometry ?? box;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.deleteAttribute("uv");
    geometry.clearGroups();
    transform.position.set(...part.position);
    transform.scale.set(...part.scale);
    const rotation: Vec3 = part.rotation ?? [0, 0, 0];
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);
    const color = new Color(part.color);
    const values = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = color.r;
      values[i + 1] = color.g;
      values[i + 2] = color.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(values, 3));
    return geometry;
  });
  const combined = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  if (!combined) throw new Error("Unable to merge cargo vehicle geometry");
  combined.computeBoundingSphere();
  return combined;
}

const rotorRadius = 2.9 * 0.17;
const rotorOffset = 2.9 / 2 - rotorRadius;
const rotorHeight = 0.85 * 0.74;
const rotorCenters: Vec3[] = [
  [rotorOffset, rotorHeight, rotorOffset],
  [-rotorOffset, rotorHeight, rotorOffset],
  [-rotorOffset, rotorHeight, -rotorOffset],
  [rotorOffset, rotorHeight, -rotorOffset],
];
const droneBodyParts: Part[] = [
  { geometry: geometries.roundedBox, position: [0, 0.425, 0], scale: [0.754, 0.238, 0.6032], color: colors.body },
  { geometry: geometries.roundedBox, position: [0, 0.561, 0], scale: [0.5278, 0.068, 0.4147], color: colors.shell },
];
const droneDetailParts: Part[] = [
  { geometry: sphere, position: [0.2262, 0.255, 0], scale: [0.085, 0.085, 0.085], color: colors.sensor },
];
for (const [x, , z] of rotorCenters) {
  droneBodyParts.push(
    { position: [x / 2, 0.527, z / 2], scale: [Math.hypot(x, z), 0.051, 0.1015], rotation: [0, -Math.atan2(z, x), 0], color: colors.accent },
    { geometry: cylinder, position: [x, 0.561, z], scale: [0.087, 0.119, 0.087], color: colors.dark },
  );
  droneDetailParts.push(
    { position: [x * 1.02, 0.51, z * 1.02], scale: [0.026, 0.026, 0.026], color: colors.light },
  );
}
for (const side of [-1, 1]) {
  droneDetailParts.push({ position: [0, 0.012, side * 0.3393], scale: [1.0556, 0.02, 0.025], color: colors.dark });
  for (const end of [-1, 1]) {
    droneDetailParts.push({ position: [end * 0.2639, 0.17, side * 0.3393], scale: [0.02, 0.306, 0.02], color: colors.dark });
  }
}
const droneBody = bake(droneBodyParts);
const droneDetails = bake(droneDetailParts);
const rotorBlade = bake([
  { position: [0, 0, 0], scale: [rotorRadius * 2, 0.012, rotorRadius * 0.16], color: colors.trim },
]);

const platformBodyParts: Part[] = [
  { geometry: geometries.roundedBox, position: [0, 0.234, 0], scale: [1.7, 0.342, 1.2], color: colors.body },
  { geometry: geometries.roundedBox, position: [0, 0.4275, 0], scale: [1.581, 0.045, 1.056], color: colors.trim },
];
const platformDetailParts: Part[] = [
  { position: [0.846, 0.2511, 0], scale: [0.014, 0.1026, 0.792], color: colors.sensor },
  { position: [-0.846, 0.2511, 0], scale: [0.014, 0.1026, 0.48], color: colors.sensor },
];
for (const side of [-1, 1]) {
  platformDetailParts.push({ position: [0, 0.1724, side * 0.603], scale: [1.054, 0.0211, 0.006], color: colors.light });
  for (const end of [-1, 1]) {
    platformBodyParts.push({ geometry: cylinder, position: [end * 0.6556, 0.108, side * 0.55], scale: [0.108, 0.06, 0.108], rotation: [Math.PI / 2, 0, 0], color: colors.dark });
    platformDetailParts.push({ geometry: cylinder, position: [end * 0.6556, 0.108, side * 0.583], scale: [0.0562, 0.012, 0.0562], rotation: [Math.PI / 2, 0, 0], color: colors.trim });
  }
}
const platformBody = bake(platformBodyParts);
const platformDetails = bake(platformDetailParts);

/** Background drone: three draw calls; only its body and arms cast shadows. */
export function CargoDrone({ animate }: { animate: boolean }) {
  const rotors = useRef<InstancedMesh>(null);
  const angle = useRef(0);
  const transform = useMemo(() => new Object3D(), []);
  const updateRotors = () => {
    const mesh = rotors.current;
    if (!mesh) return;
    rotorCenters.forEach((center, index) => {
      transform.position.set(...center);
      transform.rotation.set(0, angle.current * (index % 2 ? 1 : -1), 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    if (!rotors.current) return;
    rotors.current.instanceMatrix.setUsage(DynamicDrawUsage);
    updateRotors();
    rotors.current.computeBoundingSphere();
  }, []);
  useFrame((_, delta) => {
    if (!animate) return;
    angle.current = (angle.current + Math.min(delta, 0.05) * 24) % (Math.PI * 2);
    updateRotors();
  });
  return <group dispose={null}>
    <mesh geometry={droneBody} material={matte} castShadow receiveShadow />
    <mesh geometry={droneDetails} material={matte} />
    <instancedMesh ref={rotors} args={[rotorBlade, matte, 4]} />
  </group>;
}

/** 1.7 × 1.2 × 0.45 m platform, facing +X, drawn with two meshes. */
export function CargoPlatform() {
  return <group dispose={null}>
    <mesh geometry={platformBody} material={matte} castShadow receiveShadow />
    <mesh geometry={platformDetails} material={matte} />
  </group>;
}
