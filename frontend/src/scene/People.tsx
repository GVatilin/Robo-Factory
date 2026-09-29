import { useFrame } from "@react-three/fiber";
import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";

import { STANDING, WALKERS, type StandingLayout, type WalkerLayout } from "./layout";
import { palette } from "./palette";
import { geometries, material, seededRandom } from "./shared";
import { Walker } from "./walker";

interface FigureRefs {
  root: RefObject<Group | null>;
  body: RefObject<Group | null>;
  legs: [RefObject<Group | null>, RefObject<Group | null>];
  arms: [RefObject<Group | null>, RefObject<Group | null>];
}

function useFigureRefs(): FigureRefs {
  return {
    root: useRef<Group>(null),
    body: useRef<Group>(null),
    legs: [useRef<Group>(null), useRef<Group>(null)],
    arms: [useRef<Group>(null), useRef<Group>(null)],
  };
}

/** Минималистичный человек: капсулы корпуса, рук и ног, шар головы. */
function Figure({ refs, carry, medical = false }: { refs: FigureRefs; carry: boolean; medical?: boolean }) {
  const skin = material(medical ? "#f7fcfb" : palette.person);
  return (
    <group ref={refs.root}>
      <group ref={refs.body}>
        {([-0.1, 0.1] as const).map((x, i) => (
          <group key={x} ref={refs.legs[i]} position={[x, 0.8, 0]}>
            <mesh geometry={geometries.limb} material={medical ? material("#529e9e") : skin} position={[0, -0.39, 0]} scale={[1.1, 1.08, 1.1]} castShadow />
          </group>
        ))}
        <mesh geometry={geometries.torso} material={skin} position={[0, 1.12, 0]} castShadow />
        {([-0.27, 0.27] as const).map((x, i) => (
          <group key={x} ref={refs.arms[i]} position={[x, 1.44, 0]}>
            <mesh geometry={geometries.limb} material={skin} position={[0, -0.28, 0]} scale={[0.85, 0.82, 0.85]} castShadow />
          </group>
        ))}
        <mesh geometry={geometries.head} material={material(medical ? "#dcba9d" : palette.personHead)} position={[0, 1.68, 0]} castShadow />
        {medical && <>
          <mesh geometry={geometries.roundedBox} material={material("#56a9a2")} position={[0,1.8,0]} scale={[.28,.09,.26]}/>
          <mesh geometry={geometries.box} material={material("#309c91")} position={[-.08,1.28,.193]} scale={[.09,.12,.025]}/>
          <mesh geometry={geometries.box} material={material("#c8e5df")} position={[0,1.7,.12]} scale={[.18,.07,.025]}/>
        </>}
        {carry && (
          <mesh
            geometry={geometries.roundedBox}
            material={material(medical ? "#9ad5c6" : palette.boxes[1])}
            position={[0, 1.12, 0.36]}
            scale={[0.4, 0.3, 0.32]}
            castShadow
          />
        )}
      </group>
    </group>
  );
}

function WalkingPerson({ walker, animate, medical }: { walker: Walker; animate: boolean; medical?: boolean }) {
  const refs = useFigureRefs();

  const apply = () => {
    const root = refs.root.current;
    if (!root) return;
    root.position.set(walker.x, 0, walker.z);
    root.rotation.y = walker.heading;
    const swing = Math.sin(walker.stride) * 0.55 * walker.gait;
    refs.legs[0].current?.rotation.set(swing, 0, 0);
    refs.legs[1].current?.rotation.set(-swing, 0, 0);
    if (walker.carry) {
      // Руки вытянуты вперёд и держат коробку.
      refs.arms[0].current?.rotation.set(-1.15, 0, 0.12);
      refs.arms[1].current?.rotation.set(-1.15, 0, -0.12);
    } else {
      refs.arms[0].current?.rotation.set(-swing * 0.8, 0, 0.06);
      refs.arms[1].current?.rotation.set(swing * 0.8, 0, -0.06);
    }
    const body = refs.body.current;
    if (body) {
      body.position.y = Math.abs(Math.cos(walker.stride)) * 0.035 * walker.gait;
      body.rotation.x = 0.05 * walker.gait;
    }
  };

  useLayoutEffect(apply);
  useFrame((_, delta) => {
    if (!animate) return;
    walker.update(Math.min(delta, 0.05));
    apply();
  });

  return <Figure refs={refs} carry={walker.carry} medical={medical} />;
}

function StandingPerson({ layout, phase, animate, medical }: { layout: StandingLayout; phase: number; animate: boolean; medical?: boolean }) {
  const refs = useFigureRefs();

  const apply = (time: number) => {
    const root = refs.root.current;
    if (!root) return;
    root.position.set(layout.position[0], 0, layout.position[1]);
    // Оператор поворачивается, наблюдая за работой оборудования.
    root.rotation.y = layout.heading + Math.sin(time * 0.45 + phase) * 0.35;
    refs.arms[0].current?.rotation.set(-0.35 + Math.sin(time * 0.8 + phase) * 0.12, 0, 0.1);
    refs.arms[1].current?.rotation.set(-0.2, 0, -0.1);
    if (refs.body.current) refs.body.current.rotation.z = Math.sin(time * 0.6 + phase) * 0.02;
  };

  useLayoutEffect(() => apply(phase));
  useFrame(({ clock }) => {
    if (animate) apply(clock.elapsedTime + phase);
  });

  return <Figure refs={refs} carry={false} medical={medical} />;
}

export function People({ animate, layouts = WALKERS, standing = STANDING, medical = false }: { animate: boolean; layouts?: WalkerLayout[]; standing?: StandingLayout[]; medical?: boolean }) {
  const walkers = useMemo(() => {
    const rand = seededRandom(42);
    return layouts.map((layout) => new Walker(layout, rand));
  }, [layouts]);

  return (
    <group>
      {walkers.map((walker, index) => (
        <WalkingPerson key={index} walker={walker} animate={animate} medical={medical} />
      ))}
      {standing.map((layout, index) => (
        <StandingPerson key={index} layout={layout} phase={index * 1.7} animate={animate} medical={medical} />
      ))}
    </group>
  );
}
