import { useLayoutEffect, useRef } from "react";
import { Color, InstancedMesh, MeshStandardMaterial, Object3D, PlaneGeometry, RingGeometry } from "three";

import { geometries, material, seededRandom } from "./shared";

type Part = {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: number;
};

const structure: Part[] = [];
const details: Part[] = [];
const paintedDetails: Part[] = [];
const markings: Part[] = [];
const distant: Part[] = [];
const stations = [-12, 0, 12];
const random = seededRandom(2137);
const colors = {
  ground: "#e5eff4",
  seam: "#d4e2e9",
  frame: "#8cb1c2",
  pale: "#d7e8ef",
  shell: "#f0f6f8",
  teal: "#64acb8",
  cyan: "#9bced7",
  amber: "#d4b079",
};

function add(
  parts: Part[], position: Part["position"], size: Part["size"], color: string,
  rotation?: number,
) {
  parts.push({ position, size, color, rotation });
}

// This uninterrupted floor extends well past the fog. None of the bays have an
// enclosing wall or a raised perimeter that would reveal an edge of the world.
for (let x = -160; x <= 160; x += 4) {
  add(markings, [x, .004, 0], [.018, .008, 320], colors.seam);
}
for (let z = -160; z <= 160; z += 4) {
  add(markings, [0, .004, z], [320, .008, .018], colors.seam);
}

for (const x of stations) {
  // Flush operational apron and route markings leave the drone pad unobstructed.
  add(markings, [x, .014, 0], [6.3, .012, 6.3], "#d9eaf0");
  add(markings, [x + 1.15, .015, 6.65], [5.4, .014, 6.9], "#dbe9ec");
  for (let z = 3.6; z < 10.3; z += 1.1) {
    add(markings, [x - 1.55, .026, z], [.055, .012, .45], colors.cyan);
    add(markings, [x + 3.85, .026, z], [.055, .012, .45], colors.cyan);
  }
  // The receiving conveyor runs in +X into a dispatch enclosure. Its exact
  // .45 m top matches the contact height used by the animated robot and crate.
  // The frame ends at .40: its top must never compete with the belt at .45.
  add(structure, [x + 5.3, .215, 9], [6.25, .37, 1.65], "#adcbd5");
  add(details, [x + 5.3, .43, 9], [6.35, .04, 1.76], colors.shell);
  for (const dz of [-.76, .76]) {
    add(details, [x + 5.3, .475, 9 + dz], [6.35, .05, .055], colors.frame);
  }
  add(details, [x + 3, .31, 9.835], [.64, .045, .015], colors.teal);
  add(details, [x + 3.5, .31, 9.838], [.09, .045, .018], colors.amber);
  // Matte belt marks are decals, with no shadow casting or shadow reception.
  // They sit above the .45 contact surface and use a depth offset to keep them
  // stable when viewed from the distant orthographic camera.
  for (let dx = 2.4; dx <= 8.3; dx += .18) {
    add(paintedDetails, [x + dx, .451, 9], [.055, 0, 1.35], "#c1d8e1");
  }
  for (const dz of [-.86, .86]) {
    add(structure, [x + 8.15, 1.12, 9 + dz], [2.0, 1.36, .13], colors.pale);
  }
  add(structure, [x + 8.15, 1.83, 9], [2.1, .12, 1.92], colors.shell);
  add(structure, [x + 9.1, 1.12, 9], [.1, 1.36, 1.68], colors.pale);
  add(details, [x + 7.17, 1.66, 9], [.06, .08, 1.63], colors.teal);
  add(details, [x + 8.15, 1.4, 9.936], [.76, .23, .018], "#9bbfcb");
  add(details, [x + 8.15, 1.405, 9.95], [.49, .025, .01], "#dff3f5");
  add(details, [x + 8.83, 1.86, 9.5], [.12, .06, .18], colors.amber);

  // Slender control kiosk stands to the rear and outside the two-metre pad
  // clearance; the front stays open for the robot's collection arm.
  add(structure, [x + 3.2, .38, -1.9], [.48, .76, .52], colors.pale);
  add(details, [x + 3.2, .86, -1.9], [.63, .32, .14], colors.frame);
  add(details, [x + 3.2, .88, -1.82], [.5, .21, .018], "#dff6f5");
  for (let row = 0; row < 3; row++) {
    add(details, [x + 3.13, .94 - row * .055, -1.807], [.23 + row * .045, .016, .008], colors.teal);
  }
  add(details, [x + 3.5, 1.04, -1.9], [.045, .08, .045], colors.amber);

  // Charging cubbies are off the transport route and the pedestrian corridor.
  add(markings, [x - 4.05, .016, 6.25], [2.05, .016, 2.35], "#d2e5eb");
  add(structure, [x - 4.05, .52, 5.35], [1.58, 1.04, .34], colors.pale);
  add(details, [x - 4.05, .75, 5.53], [1.32, .31, .028], "#8cbbc6");
  for (const dx of [-.47, 0, .47]) {
    add(details, [x - 4.05 + dx, .76, 5.55], [.25, .032, .012], "#c8f0ee");
    add(details, [x - 4.05 + dx, .2, 5.58], [.15, .09, .12], colors.frame);
  }
  for (const dx of [-.83, .83]) {
    add(markings, [x - 4.05 + dx, .027, 6.15], [.04, .012, 1.9], colors.teal);
  }

  // Compact cargo lockers replace the tall warehouse shelving of the homepage.
  // Their open frames retain sightlines to the flights above the transfer pads.
  for (const offset of [-2.1, .2, 2.5]) {
    const cx = x + offset;
    for (const dx of [-.87, .87]) {
      add(structure, [cx + dx, 1.1, -9.6], [.085, 2.2, .9], "#acc9d5");
    }
    for (const y of [.12, 1.13, 2.15]) {
      add(structure, [cx, y, -9.6], [1.85, .065, 1.12], colors.pale);
    }
    for (const level of [0, 1]) {
      if (random() > .18) {
        const h = .45 + random() * .2;
        add(details, [cx, .16 + level * 1.01 + h / 2, -9.6], [1.22, h, .83], level ? "#c3dde7" : "#e7d7bd");
        add(details, [cx, .17 + level * 1.01 + h, -9.6], [.07, .014, .85], "#b5cbd4");
        add(details, [cx + .26, .17 + level * 1.01 + h / 2, -9.173], [.24, .15, .015], colors.shell);
      }
    }
    add(details, [cx, 2.23, -9.6], [.62, .04, .65], colors.teal);
  }

  // Remote supply docks sit below the inlet flight corridor at z=-18.
  add(markings, [x - 4, .015, -18], [4.1, .018, 3.8], "#d5e7ed");
  add(structure, [x - 4, .19, -18], [2.4, .38, 2.0], "#b5d1dc");
  add(details, [x - 4, .398, -18], [2.46, .035, 2.06], colors.shell);
  for (const dx of [-.83, .83]) {
    add(details, [x - 4 + dx, .424, -18], [.045, .014, 1.7], colors.teal);
  }
  add(structure, [x - 5.8, .5, -19.2], [.55, 1.0, .45], colors.pale);
  add(details, [x - 5.8, 1.045, -19.2], [.3, .06, .3], colors.amber);
}

// The pedestrian corridor is continuous and separated from the robot aprons.
// Keep z=12..14 completely clear for the existing walking figures.
for (let row = -4; row <= 4; row++) {
  const z = 13 + row * 30;
  add(markings, [0, .016, z], [320, .012, 2.35], "#edf4f6");
  for (let x = -160; x <= 160; x += 1.5) {
    add(markings, [x, .027, z - 1.35], [.55, .01, .04], "#aacad4");
  }
}

// Repeated, lower-detail bays continue in every direction. Instancing keeps
// this surrounding airport-sized cargo hall inexpensive to render.
const bayStructure = [...structure];
for (let column = -3; column <= 3; column++) {
  for (let row = -3; row <= 3; row++) {
    if (!column && !row) continue;
    const ox = column * 42;
    const oz = row * 30;
    for (const part of bayStructure) {
      add(distant, [part.position[0] + ox, part.position[1], part.position[2] + oz], part.size, part.color);
    }
    for (const x of stations) {
      add(distant, [x + ox, .12, oz], [4.3, .24, 4.3], "#c6dfe6");
      add(distant, [x + ox, .255, oz], [3.65, .03, 3.65], "#deedf1");
      add(distant, [x + ox, .28, oz], [.1, .015, 1.8], "#9bbfca");
      for (const dx of [-.6, .6]) {
        add(distant, [x + ox + dx, .28, oz], [.1, .015, 1.8], "#9bbfca");
      }
    }
  }
}

const outerRing = new RingGeometry(2.035, 2.105, 64);
const innerRing = new RingGeometry(1.63, 1.655, 64);
const glowRing = new RingGeometry(2.16, 2.21, 64);
const paintGeometry = new PlaneGeometry(1, 1);
const paintMaterial = new MeshStandardMaterial({
  color: "#ffffff", roughness: 1, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

function Batch({ parts, shadows = true, receiveShadows = true, flat = false }: {
  parts: Part[]; shadows?: boolean; receiveShadows?: boolean; flat?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const pose = new Object3D();
    const color = new Color();
    parts.forEach((part, index) => {
      pose.position.set(...part.position);
      if (flat) pose.scale.set(part.size[0], part.size[2], 1);
      else pose.scale.set(...part.size);
      pose.rotation.set(flat ? -Math.PI / 2 : 0, part.rotation ?? 0, 0);
      pose.updateMatrix();
      mesh.setMatrixAt(index, pose.matrix);
      mesh.setColorAt(index, color.set(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts, flat]);
  return <instancedMesh ref={ref} args={[flat ? paintGeometry : geometries.box, flat ? paintMaterial : material("#ffffff"), parts.length]}
    castShadow={shadows} receiveShadow={receiveShadows} dispose={null} />;
}

function LandingPad({ x }: { x: number }) {
  return <group position={[x, 0, 0]} dispose={null}>
    <mesh geometry={geometries.cylinder} material={material("#aecdd7")}
      position={[0, .185, 0]} scale={[2.34, .37, 2.34]} receiveShadow castShadow />
    <mesh geometry={geometries.cylinder} material={material(colors.shell)}
      position={[0, .4075, 0]} scale={[2.29, .085, 2.29]} receiveShadow />
    <mesh geometry={outerRing} material={material(colors.teal)}
      position={[0, .452, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    <mesh geometry={innerRing} material={material("#bedce4")}
      position={[0, .452, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    <mesh geometry={glowRing} material={material("#abdcd9")}
      position={[0, .453, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    {[-.6, .6].map((dx) => <mesh key={dx} geometry={geometries.box} material={material("#a0c6ce")}
      position={[dx, .452, 0]} scale={[.14, .004, 1.65]} />)}
    <mesh geometry={geometries.box} material={material("#a0c6ce")}
      position={[0, .452, 0]} scale={[1.06, .004, .14]} />
    {[-1, 1].flatMap((dx) => [-1, 1].map((dz) => <group key={`${dx}:${dz}`} position={[dx * 2.2, 0, dz * 2.2]}>
      <mesh geometry={geometries.cylinder} material={material(colors.frame)}
        position={[0, .25, 0]} scale={[.095, .5, .095]} castShadow />
      <mesh geometry={geometries.cylinder} material={material(dz < 0 ? colors.amber : "#8fc9c8")}
        position={[0, .525, 0]} scale={[.105, .055, .105]} />
    </group>))}
  </group>;
}

/** Open air-and-ground cargo terminal; landing and receiving surfaces are .45 m. */
export function AirCargoSet() {
  return <group>
    <mesh geometry={geometries.box} material={material(colors.ground)}
      position={[0, -.025, 0]} scale={[768, .04, 768]} receiveShadow dispose={null} />
    <Batch parts={markings} shadows={false} />
    <Batch parts={structure} />
    <Batch parts={details} />
    <Batch parts={paintedDetails} flat shadows={false} receiveShadows={false} />
    <Batch parts={distant} shadows={false} receiveShadows={false} />
    {stations.map((x) => <LandingPad key={x} x={x} />)}
  </group>;
}
