/** Общая сцена превью роботов: свет, пол с тенями и сеткой 1 м, камера, вписывающая содержимое. */

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Box3, type DirectionalLight, type GridHelper, OrthographicCamera, Vector3 } from "three";

const corner = new Vector3();
const axis = new Vector3();

/** Камера смотрит на рамку с заданного азимута и возвышения; возвращает позицию и zoom, вписывающие рамку. */
function frame(camera: OrthographicCamera, box: Box3, width: number, height: number, azimuth: number, elevation: number, padding: number) {
  const center = box.getCenter(new Vector3());
  const direction = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  const position = center.clone().addScaledVector(direction, 120);
  camera.position.copy(position);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
    }
  }
  // Сдвиг камеры в плоскости экрана: центр проекции рамки — в центр кадра.
  position.addScaledVector(axis.setFromMatrixColumn(camera.matrixWorld, 0), (minX + maxX) / 2);
  position.addScaledVector(axis.setFromMatrixColumn(camera.matrixWorld, 1), (minY + maxY) / 2);
  const zoom = Math.min(width / ((maxX - minX) * padding), height / ((maxY - minY) * padding));
  return { position, zoom };
}

interface CameraRigProps {
  box: Box3;
  azimuth: number;
  elevation: number;
  padding?: number;
  /** Плавный переход при изменении габаритов. */
  smooth: boolean;
}

export function CameraRig({ box, azimuth, elevation, padding = 1.18, smooth }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as OrthographicCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const target = useRef<{ position: Vector3; zoom: number } | null>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const probe = camera.clone();
    target.current = frame(probe, box, size.width, size.height, azimuth, elevation, padding);
    if (!smooth || !placed.current) {
      camera.position.copy(target.current.position);
      camera.zoom = target.current.zoom;
      camera.quaternion.copy(probe.quaternion);
      camera.updateProjectionMatrix();
      placed.current = true;
    }
    invalidate();
  }, [camera, box, size.width, size.height, azimuth, elevation, padding, smooth, invalidate]);

  useFrame((_, delta) => {
    const goal = target.current;
    if (!smooth || !goal) return;
    const k = 1 - Math.exp(-delta * 6);
    camera.position.lerp(goal.position, k);
    camera.zoom += (goal.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
  });

  return null;
}

/** Свет со сменой области теней под размер сцены. */
export function StageLights({ radius }: { radius: number }) {
  const light = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const current = light.current;
    if (!current) return;
    const extent = radius * 1.6;
    const shadow = current.shadow.camera;
    shadow.left = -extent;
    shadow.right = extent;
    shadow.top = extent;
    shadow.bottom = -extent;
    shadow.near = 0.1;
    shadow.far = radius * 12;
    shadow.updateProjectionMatrix();
    current.position.set(-radius * 1.6, radius * 4, radius * 2.2);
    current.target.position.set(0, 0, 0);
    current.target.updateMatrixWorld();
  }, [radius]);

  return (
    <>
      <hemisphereLight args={["#ffffff", "#b6cef1", 1.85]} />
      <directionalLight
        ref={light}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
    </>
  );
}

/** Пол: тени на прозрачной плоскости и сетка с шагом 1 м — масштаб читается сразу. */
export function StageFloor({ extent, center = [0, 0] }: { extent: number; center?: [number, number] }) {
  const grid = useRef<GridHelper>(null);
  const cells = Math.max(2, Math.ceil(extent * 2));
  useLayoutEffect(() => {
    const material = grid.current?.material;
    if (material && !Array.isArray(material)) {
      material.transparent = true;
      material.opacity = 0.55;
      material.depthWrite = false;
    }
  }, [cells]);
  return (
    <group position={[center[0], 0, center[1]]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[cells * 3, cells * 3]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
      <gridHelper key={cells} ref={grid} args={[cells, cells, "#9fbbe6", "#c3d5ef"]} position={[0, 0.001, 0]} />
    </group>
  );
}

/** Рамка, в которую поместится содержимое при любом повороте вокруг вертикали. */
export function useTurntableBox(radius: number, height: number): Box3 {
  return useMemo(
    () => new Box3(new Vector3(-radius, 0, -radius), new Vector3(radius, Math.max(height, 0.3), radius)),
    [radius, height],
  );
}
