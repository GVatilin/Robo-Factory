import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Box3, Vector3 } from "three";

import type { RobotKind, Size } from "./kinds";
import { Footprint, RobotModel, ScaleFigure } from "./RobotModel";
import { CameraRig, StageFloor, StageLights } from "./Stage";

const GL = { antialias: true, alpha: true, powerPreference: "high-performance" as const };
const CAMERA = { position: [8, 6, 8] as [number, number, number], zoom: 60, near: 0.1, far: 800 };

export interface LineupItem {
  id: number;
  kind: RobotKind;
  size: Size;
}

interface LineupProps {
  items: LineupItem[];
  highlighted: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
  animate: boolean;
}

/** Линейка решений производителя в одном масштабе, слева — человек ростом 1,8 м. */
export default function Lineup({ items, highlighted, onHover, onSelect, animate }: LineupProps) {
  const layout = useMemo(() => {
    const sizes = items.map((item) => Math.max(item.size.l, item.size.w));
    const gap = Math.max(0.4, (sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length)) * 0.35);
    let cursor = 0.35 + gap;
    const placed = items.map((item) => {
      const x = cursor + item.size.l / 2;
      cursor += item.size.l + gap;
      return { ...item, x };
    });
    const maxW = Math.max(0.6, ...items.map((i) => i.size.w));
    const maxH = Math.max(1.82, ...items.map((i) => i.size.h));
    const box = new Box3(new Vector3(-0.35, 0, -maxW / 2), new Vector3(cursor - gap, maxH, maxW / 2));
    return { placed, box, center: (cursor - gap - 0.35) / 2, extent: Math.max(cursor, maxW) / 2 + 1 };
  }, [items]);

  useEffect(() => () => void (document.body.style.cursor = ""), []);

  const over = (id: number) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    onHover(id);
  };
  const out = () => {
    document.body.style.cursor = "";
    onHover(null);
  };

  return (
    <div className="lineup-canvas">
      <Canvas orthographic flat shadows="percentage" dpr={[1, 1.75]} gl={GL} camera={CAMERA} frameloop={animate ? "always" : "demand"}>
        <CameraRig box={layout.box} azimuth={0.42} elevation={0.3} padding={1.08} smooth={false} />
        <StageLights radius={layout.extent} />
        <StageFloor extent={layout.extent} center={[layout.center, 0]} />
        <ScaleFigure x={0} rotation={0.4} />
        {layout.placed.map((item) => {
          const active = item.id === highlighted;
          return (
            <group
              key={item.id}
              position={[item.x, active ? Math.max(0.03, item.size.h * 0.04) : 0, 0]}
              onPointerOver={over(item.id)}
              onPointerOut={out}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item.id);
              }}
            >
              <RobotModel kind={item.kind} size={item.size} tone={active ? "highlight" : "default"} animate={animate} />
              {active && <Footprint l={item.size.l} w={item.size.w} color="#2463d8" />}
            </group>
          );
        })}
      </Canvas>
    </div>
  );
}
