import { useFrame } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Group, Mesh } from "three";

import { ARM, ArmCell, CELL_BOX, CONVEYOR_TOP, PALLET_TOP } from "./armCell";
import type { CellLayout, Point } from "./layout";
import { palette } from "./palette";
import { geometries, material } from "./shared";

const JOINT_AXIS: [number, number, number] = [Math.PI / 2, 0, 0];

function Conveyor({ from, to }: { from: Point; to: Point }) {
  const [ax, az] = from;
  const [bx, bz] = to;
  const length = Math.hypot(bx - ax, bz - az) + 0.7;
  const heading = Math.atan2(bx - ax, bz - az);
  const legs = [-length / 2 + 0.3, 0, length / 2 - 0.3];
  const frame = material(palette.conveyor);
  return (
    <group position={[(ax + bx) / 2, 0, (az + bz) / 2]} rotation-y={heading}>
      <mesh geometry={geometries.box} material={frame} position={[0, CONVEYOR_TOP - 0.06, 0]} scale={[0.8, 0.1, length]} castShadow receiveShadow />
      <mesh geometry={geometries.box} material={material(palette.belt)} position={[0, CONVEYOR_TOP - 0.005, 0]} scale={[0.66, 0.02, length - 0.06]} receiveShadow />
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} geometry={geometries.box} material={frame} position={[x, CONVEYOR_TOP + 0.03, 0]} scale={[0.05, 0.08, length]} castShadow />
      ))}
      {legs.flatMap((z) =>
        [-0.32, 0.32].map((x) => (
          <mesh key={`${z}:${x}`} geometry={geometries.box} material={frame} position={[x, (CONVEYOR_TOP - 0.1) / 2, z]} scale={[0.06, CONVEYOR_TOP - 0.1, 0.06]} castShadow />
        )),
      )}
      {/* Упор на конце ленты, у точки захвата. */}
      <mesh geometry={geometries.box} material={material(palette.robotJoint)} position={[0, CONVEYOR_TOP + 0.07, length / 2 - 0.03]} scale={[0.8, 0.14, 0.06]} castShadow />
    </group>
  );
}

function Pallet({ at }: { at: Point }) {
  const wood = material(palette.pallet);
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh geometry={geometries.box} material={wood} position={[0, PALLET_TOP - 0.05, 0]} scale={[1.2, 0.1, 1.0]} castShadow receiveShadow />
      {[-0.42, 0, 0.42].map((z) => (
        <mesh key={z} geometry={geometries.box} material={wood} position={[0, 0.03, z]} scale={[1.2, 0.06, 0.14]} castShadow />
      ))}
    </group>
  );
}

interface ManipulatorProps {
  layout: CellLayout;
  seed: number;
  animate: boolean;
}

/** Ячейка паллетизации: конвейер → манипулятор → паллета. */
export function Manipulator({ layout, seed, animate }: ManipulatorProps) {
  const cell = useMemo(() => new ArmCell(layout, seed), [layout, seed]);
  const turret = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const wrist = useRef<Group>(null);
  const boxes = useRef<(Mesh | null)[]>([]);

  const apply = useCallback(() => {
    const { pose } = cell;
    if (turret.current) turret.current.rotation.y = pose.yaw;
    if (shoulder.current) shoulder.current.rotation.z = pose.shoulder;
    if (elbow.current) elbow.current.rotation.z = pose.elbow;
    if (wrist.current) wrist.current.rotation.z = pose.wrist;
    cell.boxes.forEach((box, index) => {
      const mesh = boxes.current[index];
      if (!mesh) return;
      mesh.visible = box.mode !== "hidden" && box.scale > 0.001;
      mesh.position.set(box.x, box.y, box.z);
      mesh.scale.set(CELL_BOX.w * box.scale, CELL_BOX.h * box.scale, CELL_BOX.d * box.scale);
    });
  }, [cell]);

  useLayoutEffect(apply, [apply]);
  useFrame((_, delta) => {
    if (!animate) return;
    cell.update(Math.min(delta, 0.05));
    apply();
  });

  const body = material(palette.robot);
  const joint = material(palette.robotJoint);
  const tool = material(palette.robotTool);
  const [bx, bz] = layout.base;

  return (
    <group>
      <Conveyor from={layout.beltStart} to={layout.pick} />
      <Pallet at={layout.pallet} />
      {/* Пульт оператора — вне радиуса поворота руки. */}
      <mesh geometry={geometries.box} material={body} position={[bx - 2.7, 0.55, bz + 1.7]} scale={[0.55, 1.1, 0.4]} castShadow receiveShadow />

      <group position={[bx, 0, bz]}>
        <mesh geometry={geometries.cylinder} material={joint} position={[0, ARM.baseHeight / 2, 0]} scale={[0.58, ARM.baseHeight, 0.58]} castShadow receiveShadow />
        <group ref={turret}>
          <mesh
            geometry={geometries.cylinder}
            material={body}
            position={[0, (ARM.baseHeight + ARM.shoulderY) / 2, 0]}
            scale={[0.42, ARM.shoulderY - ARM.baseHeight, 0.42]}
            castShadow
          />
          <group ref={shoulder} position={[0, ARM.shoulderY, 0]}>
            <mesh geometry={geometries.cylinder} material={joint} rotation={JOINT_AXIS} scale={[0.27, 0.62, 0.27]} castShadow />
            <mesh geometry={geometries.roundedBox} material={body} position={[ARM.upper / 2, 0, 0]} scale={[ARM.upper + 0.12, 0.3, 0.34]} castShadow />
            <group ref={elbow} position={[ARM.upper, 0, 0]}>
              <mesh geometry={geometries.cylinder} material={joint} rotation={JOINT_AXIS} scale={[0.21, 0.46, 0.21]} castShadow />
              <mesh geometry={geometries.roundedBox} material={body} position={[ARM.fore / 2, 0, 0]} scale={[ARM.fore, 0.22, 0.24]} castShadow />
              <group ref={wrist} position={[ARM.fore, 0, 0]}>
                <mesh geometry={geometries.cylinder} material={joint} rotation={JOINT_AXIS} scale={[0.13, 0.3, 0.13]} castShadow />
                <mesh
                  geometry={geometries.cylinder}
                  material={body}
                  position={[ARM.wrist / 2 - 0.03, 0, 0]}
                  rotation-z={Math.PI / 2}
                  scale={[0.09, ARM.wrist - 0.06, 0.09]}
                  castShadow
                />
                {/* Вакуумный захват. */}
                <mesh
                  geometry={geometries.cylinder}
                  material={tool}
                  position={[ARM.wrist - 0.025, 0, 0]}
                  rotation-z={Math.PI / 2}
                  scale={[0.2, 0.05, 0.2]}
                  castShadow
                />
              </group>
            </group>
          </group>
        </group>
      </group>

      {cell.boxes.map((box, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            boxes.current[index] = mesh;
          }}
          geometry={geometries.roundedBox}
          material={material(palette.boxes[index % palette.boxes.length])}
          visible={box.mode !== "hidden"}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}
