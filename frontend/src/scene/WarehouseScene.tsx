import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { MathUtils, Vector3 } from "three";

import { CELLS } from "./layout";
import { Manipulator } from "./Manipulator";
import { palette } from "./palette";
import { People } from "./People";
import { Warehouse } from "./Warehouse";

/** Вид сверху и немного сбоку. */
const ELEVATION = MathUtils.degToRad(61);
const AZIMUTH = MathUtils.degToRad(20);
const DISTANCE = 80;
const CENTER = new Vector3(1.5, 0, 2.6);
/** Сколько метров склада видно по ширине и высоте экрана (берётся большее приближение). */
const VIEW = { width: 46, height: 28 };

const CAMERA = { position: [30, 50, 50] as [number, number, number], zoom: 40, near: 0.1, far: 400 };
const GL = { antialias: true, powerPreference: "high-performance" as const };

function CameraRig({ animate }: { animate: boolean }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const target = useMemo(() => new Vector3(), []);

  const place = useCallback(
    (azimuth: number) => {
      const horizontal = DISTANCE * Math.cos(ELEVATION);
      camera.position.set(
        target.x + horizontal * Math.sin(azimuth),
        target.y + DISTANCE * Math.sin(ELEVATION),
        target.z + horizontal * Math.cos(azimuth),
      );
      camera.lookAt(target);
    },
    [camera, target],
  );

  useLayoutEffect(() => {
    const aspect = size.width / size.height;
    camera.zoom = Math.max(size.width / VIEW.width, size.height / VIEW.height);
    // На широком экране сцена сдвигается вправо, чтобы текст слева не закрывал роботов.
    const shift = MathUtils.clamp((aspect - 1.15) * 5, 0, 5.5);
    target.set(CENTER.x - Math.cos(AZIMUTH) * shift, 0, CENTER.z + Math.sin(AZIMUTH) * shift);
    place(AZIMUTH);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, place, target, invalidate]);

  useFrame(({ clock }) => {
    if (animate) place(AZIMUTH + Math.sin(clock.elapsedTime * 0.06) * 0.04);
  });

  return null;
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#ffffff", "#b6cef1", 1.75]} />
      <directionalLight
        position={[-16, 30, 14]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={3}
      >
        <orthographicCamera attach="shadow-camera" args={[-30, 30, 30, -30, 1, 90]} />
      </directionalLight>
    </>
  );
}

/** Фоновая сцена лендинга: склад, по которому ходят люди и работают манипуляторы. */
export default function WarehouseScene({ animate }: { animate: boolean }) {
  return (
    <Canvas
      orthographic
      flat
      shadows="percentage"
      dpr={[1, 1.75]}
      camera={CAMERA}
      gl={GL}
      frameloop={animate ? "always" : "demand"}
    >
      <color attach="background" args={[palette.background]} />
      <CameraRig animate={animate} />
      <Lights />
      <Warehouse />
      {CELLS.map((layout, index) => (
        <Manipulator key={index} layout={layout} seed={101 + index * 17} animate={animate} />
      ))}
      <People animate={animate} />
    </Canvas>
  );
}
