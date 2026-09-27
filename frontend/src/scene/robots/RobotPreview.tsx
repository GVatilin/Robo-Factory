import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { MathUtils, type Group } from "three";

import type { RobotKind, Size } from "./kinds";
import { Footprint, RobotModel, ScaleFigure } from "./RobotModel";
import { CameraRig, StageFloor, StageLights, useTurntableBox } from "./Stage";

const GL = { antialias: true, alpha: true, powerPreference: "high-performance" as const };
const CAMERA = { position: [8, 6, 8] as [number, number, number], zoom: 80, near: 0.1, far: 600 };

interface Drag {
  active: boolean;
  lastX: number;
  /** Угол, набранный перетаскиванием; автоповорот добавляется к нему. */
  angle: number;
  velocity: number;
}

function Turntable({ drag, animate, children }: { drag: RefObject<Drag>; animate: boolean; children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    const state = drag.current;
    if (!group.current || !state) return;
    if (!animate) {
      // Без анимации кадр рисуется только по запросу: поворот применяется сразу, без инерции.
      group.current.rotation.y = state.angle;
      return;
    }
    if (!state.active) {
      // Инерция после перетаскивания и медленный автоповорот.
      state.angle += state.velocity + delta * 0.28;
      state.velocity *= 0.92;
    }
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, state.angle, 12, delta);
  });
  return <group ref={group}>{children}</group>;
}

interface RobotPreviewProps {
  kind: RobotKind;
  size: Size;
  animate: boolean;
  /** Показать человека для масштаба. */
  figure?: boolean;
}

/** Передаёт наружу invalidate: в режиме frameloop="demand" кадр перерисовывается при перетаскивании. */
function InvalidateBridge({ target }: { target: RefObject<(() => void) | null> }) {
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    target.current = invalidate;
  }, [invalidate, target]);
  return null;
}

/** Превью робота: модель в масштабе рядом с человеком, вращение мышью или пальцем. */
export default function RobotPreview({ kind, size, animate, figure = true }: RobotPreviewProps) {
  const drag = useRef<Drag>({ active: false, lastX: 0, angle: -0.6, velocity: 0 });
  const invalidate = useRef<(() => void) | null>(null);
  const figureX = -(size.l / 2) - 0.55;
  const radius = Math.max(Math.hypot(Math.max(size.l / 2, figure ? -figureX + 0.3 : 0), size.w / 2), 0.4);
  const height = Math.max(size.h, figure ? 1.82 : 0);
  const box = useTurntableBox(radius, height);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current.active = true;
    drag.current.lastX = event.clientX;
    drag.current.velocity = 0;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state.active) return;
    const delta = ((event.clientX - state.lastX) / event.currentTarget.clientWidth) * Math.PI * 1.6;
    state.angle += delta;
    state.velocity = delta * 0.5;
    state.lastX = event.clientX;
    invalidate.current?.();
  };
  const onPointerUp = () => {
    drag.current.active = false;
  };

  return (
    <div
      className="robot-preview"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Canvas orthographic flat shadows="percentage" dpr={[1, 1.75]} gl={GL} camera={CAMERA} frameloop={animate ? "always" : "demand"}>
        <InvalidateBridge target={invalidate} />
        <CameraRig box={box} azimuth={0.62} elevation={0.42} smooth={animate} />
        <StageLights radius={radius} />
        <StageFloor extent={radius} />
        <Turntable drag={drag} animate={animate}>
          <RobotModel kind={kind} size={size} animate={animate} />
          {kind !== "software" && <Footprint l={size.l} w={size.w} />}
          {figure && <ScaleFigure x={figureX} rotation={Math.PI / 4} />}
        </Turntable>
      </Canvas>
    </div>
  );
}
