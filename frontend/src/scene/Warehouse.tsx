import { useLayoutEffect, useMemo, useRef } from "react";
import { BufferGeometry, Color, InstancedMesh, Object3D } from "three";

import { CELL_BOX } from "./armCell";
import { CELLS, DOCK_DOORS, FLOOR, MAIN_AISLE, RACK, STAGING_ROWS, WALL } from "./layout";
import { palette } from "./palette";
import { geometries, material, seededRandom } from "./shared";

interface Item {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color?: string;
}

interface InstancesProps {
  items: Item[];
  geometry: BufferGeometry;
  color: string;
  shadows?: boolean;
}

/** Набор одинаковых объектов одним вызовом отрисовки. */
function Instances({ items, geometry, color, shadows = true }: InstancesProps) {
  const ref = useRef<InstancedMesh>(null);
  const perInstanceColor = items.some((item) => item.color);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new Object3D();
    const tint = new Color();
    items.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (perInstanceColor) mesh.setColorAt(index, tint.set(item.color ?? color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, color, perInstanceColor]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material(perInstanceColor ? "#ffffff" : color), items.length]}
      castShadow={shadows}
      receiveShadow
    />
  );
}

function pick<T>(values: readonly T[], rand: () => number): T {
  return values[Math.floor(rand() * values.length)];
}

function buildRacks(rand: () => number, occupancy: number, rackRowCount: number) {
  const posts: Item[] = [];
  const shelves: Item[] = [];
  const beams: Item[] = [];
  const boxes: Item[] = [];
  const length = RACK.xEnd - RACK.xStart;
  const centerX = (RACK.xStart + RACK.xEnd) / 2;
  const bayWidth = length / RACK.bays;
  const shelfLevels: readonly number[] = RACK.levels;

  for (const row of RACK.rows.slice(0, rackRowCount)) {
    const sides = [row.z - row.depth / 2 + 0.05, row.z + row.depth / 2 - 0.05];
    for (let bay = 0; bay <= RACK.bays; bay++) {
      for (const z of sides) {
        posts.push({ x: RACK.xStart + bay * bayWidth, y: RACK.top / 2, z, sx: 0.09, sy: RACK.top, sz: 0.09 });
      }
    }
    for (const y of shelfLevels) {
      shelves.push({ x: centerX, y, z: row.z, sx: length, sy: 0.045, sz: row.depth });
      for (const z of sides) beams.push({ x: centerX, y: y - 0.05, z, sx: length, sy: 0.09, sz: 0.07 });
    }

    // Коробки на полках: 1–3 штуки в ячейке, часть ячеек пустая.
    const slots = row.depth > 2 ? [row.z - row.depth / 4, row.z + row.depth / 4] : [row.z];
    const slotDepth = row.depth / slots.length;
    RACK.levels.forEach((levelY, level) => {
      const gap = (shelfLevels[level + 1] ?? levelY + 0.8) - levelY;
      for (let bay = 0; bay < RACK.bays; bay++) {
        const bayStart = RACK.xStart + bay * bayWidth;
        const bayEnd = bayStart + bayWidth;
        for (const slotZ of slots) {
          let cursor = bayStart + 0.1;
          while (cursor < bayEnd - 0.4) {
            let width = 0.5 + rand() * 0.4;
            if (cursor + width > bayEnd - 0.08) width = bayEnd - 0.08 - cursor;
            if (width < 0.35) break;
            if (rand() > 1 - occupancy) {
              const height = 0.3 + rand() * (gap - 0.45);
              boxes.push({
                x: cursor + width / 2,
                y: levelY + 0.0225 + height / 2,
                z: slotZ + (rand() - 0.5) * 0.06,
                sx: width,
                sy: height,
                sz: slotDepth * (0.72 + rand() * 0.18),
                color: pick(palette.boxes, rand),
              });
            }
            cursor += width + 0.06 + rand() * 0.08;
          }
        }
      }
    });
  }
  return { posts, shelves, beams, boxes };
}

function buildStaging(rand: () => number, occupancy: number, dockCount: number) {
  const pallets: Item[] = [];
  const boxes: Item[] = [];
  const offsets = [
    [-0.29, -0.24],
    [0.29, -0.24],
    [-0.29, 0.24],
    [0.29, 0.24],
  ] as const;
  for (const x of DOCK_DOORS.slice(0, dockCount)) {
    for (const z of STAGING_ROWS) {
      if (rand() < 1 - occupancy) continue;
      pallets.push({ x, y: 0.07, z, sx: 1.2, sy: 0.14, sz: 1.0 });
      const layers = 1 + Math.floor(rand() * 3);
      for (let layer = 0; layer < layers; layer++) {
        for (const [ox, oz] of offsets) {
          if (layer === layers - 1 && rand() < 0.3) continue;
          boxes.push({
            x: x + ox,
            y: 0.14 + layer * CELL_BOX.h + CELL_BOX.h / 2,
            z: z + oz,
            sx: CELL_BOX.w,
            sy: CELL_BOX.h,
            sz: CELL_BOX.d,
            color: pick(palette.boxes, rand),
          });
        }
      }
    }
  }
  return { pallets, boxes };
}

/** Линии разметки и подсветка зон на полу. */
function buildMarkings() {
  const line = 0.07;
  const lines: Item[] = [];
  const zones: Item[] = [];
  const at = (x: number, z: number, sx: number, sz: number, list: Item[], y = 0.006) =>
    list.push({ x, y, z, sx, sy: 0.01, sz });

  at(0.1, MAIN_AISLE.zBack, 43, line, lines);
  at(0.1, MAIN_AISLE.zFront, 43, line, lines);
  at(0.1, 12.1, 43, line, lines);
  for (let i = 0; i < 5; i++) at(-1.2 + i * 0.6, 0.22, 0.2, 3.6, lines);

  for (const x of [4, 8, 12, 16, 20]) at(x, -9.4, line, 8, lines);
  at(12, -9.4, 16, 8, zones, 0.003);

  for (const cell of CELLS) {
    const [cx] = cell.base;
    const [x0, x1, z0, z1] = [cx - 3.25, cx + 3.25, 5.6, 10.0];
    at(cx, z0, x1 - x0, line, lines);
    at(cx, z1, x1 - x0, line, lines);
    at(x0, (z0 + z1) / 2, line, z1 - z0, lines);
    at(x1, (z0 + z1) / 2, line, z1 - z0, lines);
    at(cx, (z0 + z1) / 2, x1 - x0, z1 - z0, zones, 0.003);
  }
  return { lines, zones };
}

function Walls({ dockCount, width, depth }: { dockCount: number; width: number; depth: number }) {
  const wall = material(palette.wall);
  const innerZ = -depth / 2 + WALL.thickness;
  return (
    <group>
      <mesh
        geometry={geometries.box}
        material={wall}
        position={[0, WALL.height / 2, -depth / 2 + WALL.thickness / 2]}
        scale={[width, WALL.height, WALL.thickness]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={wall}
        position={[-width / 2 + WALL.thickness / 2, WALL.height / 2, 0]}
        scale={[WALL.thickness, WALL.height, depth]}
        castShadow
        receiveShadow
      />
      {DOCK_DOORS.slice(0, dockCount).map((x) => (
        <group key={x} position={[x, 0, innerZ]}>
          <mesh
            geometry={geometries.box}
            material={material(palette.door)}
            position={[0, 1.15, 0.03]}
            scale={[2.5, 2.2, 0.06]}
            receiveShadow
          />
          {[-1.1, 1.1].map((dx) => (
            <mesh
              key={dx}
              geometry={geometries.box}
              material={material(palette.robotJoint)}
              position={[dx, 0.35, 0.09]}
              scale={[0.2, 0.3, 0.14]}
              castShadow
            />
          ))}
        </group>
      ))}
    </group>
  );
}

export function Warehouse({ seed = 7, occupancy = 0.84, dockCount = DOCK_DOORS.length, rackRows = RACK.rows.length, width = FLOOR.width, depth = FLOOR.depth }: { seed?: number; occupancy?: number; dockCount?: number; rackRows?: number; width?: number; depth?: number }) {
  const floorWidth = Math.max(FLOOR.width, width);
  const floorDepth = Math.max(FLOOR.depth, depth);
  const density = Math.min(0.98, Math.max(0.18, occupancy));
  const visibleDocks = Math.min(DOCK_DOORS.length, Math.max(1, Math.round(dockCount)));
  const visibleRackRows = Math.min(RACK.rows.length, Math.max(1, Math.round(rackRows)));
  const racks = useMemo(() => buildRacks(seededRandom(seed), density, visibleRackRows), [seed, density, visibleRackRows]);
  const staging = useMemo(() => buildStaging(seededRandom(seed + 12), density, visibleDocks), [seed, density, visibleDocks]);
  const markings = useMemo(buildMarkings, []);
  const allBoxes = useMemo(() => [...racks.boxes, ...staging.boxes], [racks, staging]);

  return (
    <group>
      {/* Подложка вокруг склада: на неё падает тень от плиты пола. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -FLOOR.thickness, 0]} material={material(palette.ground)} receiveShadow>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <mesh
        geometry={geometries.box}
        material={material(palette.floor)}
        position={[0, -FLOOR.thickness / 2, 0]}
        scale={[floorWidth, FLOOR.thickness, floorDepth]}
        castShadow
        receiveShadow
      />
      <Walls dockCount={visibleDocks} width={floorWidth} depth={floorDepth} />
      <Instances items={markings.zones} geometry={geometries.box} color={palette.zone} shadows={false} />
      <Instances items={markings.lines} geometry={geometries.box} color={palette.marking} shadows={false} />
      <Instances items={racks.posts} geometry={geometries.box} color={palette.rack} />
      <Instances items={racks.beams} geometry={geometries.box} color={palette.rack} />
      <Instances items={racks.shelves} geometry={geometries.box} color={palette.shelf} />
      <Instances items={staging.pallets} geometry={geometries.box} color={palette.pallet} />
      <Instances items={allBoxes} geometry={geometries.roundedBox} color={palette.boxes[0]} />
    </group>
  );
}
