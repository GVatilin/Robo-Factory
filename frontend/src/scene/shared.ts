import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Общие геометрии: создаются один раз и масштабируются через mesh.scale. */
export const geometries = {
  box: new BoxGeometry(1, 1, 1),
  roundedBox: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
  cylinder: new CylinderGeometry(1, 1, 1, 28),
  torso: new CapsuleGeometry(0.2, 0.42, 4, 14),
  limb: new CapsuleGeometry(0.07, 0.5, 3, 8),
  head: new SphereGeometry(0.13, 18, 14),
};

const materials = new Map<string, MeshStandardMaterial>();

/** Матовый материал заданного цвета; один экземпляр на цвет. */
export function material(color: string): MeshStandardMaterial {
  let result = materials.get(color);
  if (!result) {
    result = new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
    materials.set(color, result);
  }
  return result;
}

/** Детерминированный генератор случайных чисел: сцена одинакова при каждой загрузке. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Угол в диапазоне (−π, π]. */
export function wrapAngle(angle: number): number {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
