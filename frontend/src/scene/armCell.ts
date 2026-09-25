/**
 * Симуляция ячейки паллетизации: конвейер подаёт коробки, манипулятор переносит их на паллету.
 * Состояние меняется в update(); компонент только применяет его к мешам.
 */

import type { CellLayout } from "./layout";
import { easeInOut, seededRandom, wrapAngle } from "./shared";

/** Размеры манипулятора, м. Звенья: плечо → предплечье → кисть с вакуумным захватом, направленным вниз. */
export const ARM = { baseHeight: 0.3, shoulderY: 0.95, upper: 1.75, fore: 1.55, wrist: 0.5 } as const;
export const CELL_BOX = { w: 0.52, h: 0.4, d: 0.44 } as const;
export const CONVEYOR_TOP = 0.75;
export const PALLET_TOP = 0.16;

const SLOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-0.29, -0.24],
  [0.29, -0.24],
  [-0.29, 0.24],
  [0.29, 0.24],
];
const LAYERS = 3;
export const PALLET_CAPACITY = SLOT_OFFSETS.length * LAYERS;
export const BOX_POOL = PALLET_CAPACITY + 6;

const BELT_SPEED = 0.6;
const SPACING = 0.78;
const MAX_ON_BELT = 4;
const HOVER = 0.85;
const ARC = 0.35;
const CLEAR_DELAY = 0.8;
const CLEAR_DURATION = 0.7;
const TAU = Math.PI * 2;

type Phase =
  | "toPick"
  | "waitBox"
  | "descendPick"
  | "grip"
  | "ascendPick"
  | "toPlace"
  | "holdPlace"
  | "descendPlace"
  | "release"
  | "ascendPlace";

const DURATION: Record<Phase, number> = {
  toPick: 1.05,
  waitBox: 0,
  descendPick: 0.45,
  grip: 0.18,
  ascendPick: 0.45,
  toPlace: 1.25,
  holdPlace: 0,
  descendPlace: 0.5,
  release: 0.18,
  ascendPlace: 0.45,
};

export interface ArmPose {
  yaw: number;
  shoulder: number;
  elbow: number;
  wrist: number;
}

type BoxMode = "hidden" | "belt" | "held" | "placed" | "clearing";

export interface CellBox {
  mode: BoxMode;
  /** Пройденный путь по конвейеру, м. */
  s: number;
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** Положение захвата в цилиндрических координатах относительно основания робота. */
interface Cyl {
  r: number;
  theta: number;
  y: number;
}

/**
 * Обратная кинематика двухзвенной руки с захватом, смотрящим вниз.
 * (dx, dy, dz) — точка захвата относительно основания. Решение «локоть вверх».
 */
export function solveArm(dx: number, dy: number, dz: number, out: ArmPose): ArmPose {
  const { shoulderY, upper, fore, wrist } = ARM;
  let wx = Math.hypot(dx, dz);
  let wy = dy + wrist - shoulderY;
  const reach = Math.hypot(wx, wy);
  const clamped = Math.min(Math.max(reach, Math.abs(upper - fore) + 0.05), upper + fore - 0.02);
  if (reach > 1e-6 && clamped !== reach) {
    wx *= clamped / reach;
    wy *= clamped / reach;
  }
  const cosElbow = (wx * wx + wy * wy - upper * upper - fore * fore) / (2 * upper * fore);
  const elbow = -Math.acos(Math.min(1, Math.max(-1, cosElbow)));
  const shoulder = Math.atan2(wy, wx) - Math.atan2(fore * Math.sin(elbow), upper + fore * Math.cos(elbow));
  out.yaw = Math.atan2(-dz, dx);
  out.shoulder = shoulder;
  out.elbow = elbow;
  out.wrist = -Math.PI / 2 - shoulder - elbow;
  return out;
}

function positiveAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export class ArmCell {
  readonly boxes: CellBox[] = [];
  readonly pose: ArmPose = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0 };

  private readonly layout: CellLayout;
  private readonly rand: () => number;
  private readonly tempo: number;
  private readonly beltLength: number;
  private readonly dirX: number;
  private readonly dirZ: number;

  private phase: Phase = "waitBox";
  private elapsed = 0;
  private readonly tip: Cyl = { r: 0, theta: 0, y: 0 };
  private from: Cyl = { r: 0, theta: 0, y: 0 };
  private to: Cyl = { r: 0, theta: 0, y: 0 };
  private held: CellBox | null = null;
  private slot = 0;
  private clearing = false;
  private clearTime = 0;
  private spawnIn = 0;

  constructor(layout: CellLayout, seed: number) {
    this.layout = layout;
    this.rand = seededRandom(seed);
    this.tempo = 0.88 + this.rand() * 0.22;
    const [sx, sz] = layout.beltStart;
    const [px, pz] = layout.pick;
    this.beltLength = Math.hypot(px - sx, pz - sz);
    this.dirX = (px - sx) / this.beltLength;
    this.dirZ = (pz - sz) / this.beltLength;

    for (let i = 0; i < BOX_POOL; i++) {
      this.boxes.push({ mode: "hidden", s: 0, x: 0, y: 0, z: 0, scale: 0 });
    }
    // Стартовое состояние: паллета частично заполнена, на конвейере ждут коробки.
    const prefilled = Math.floor(this.rand() * (PALLET_CAPACITY - 3));
    for (let i = 0; i < prefilled; i++) this.placeBox(this.freeBox()!, i);
    this.slot = prefilled;
    for (let i = 0; i < 2; i++) {
      const box = this.freeBox()!;
      box.mode = "belt";
      box.s = this.beltLength - i * SPACING;
      box.scale = 1;
    }
    this.spawnIn = 1 + this.rand() * 2;
    Object.assign(this.tip, this.pickTarget(HOVER));
    this.begin("waitBox", this.tip);
    this.sync();

    // Ячейки стартуют в разных фазах цикла.
    const warmup = this.rand() * 4;
    for (let t = 0; t < warmup; t += 1 / 30) this.update(1 / 30);
  }

  update(delta: number): void {
    const dt = delta * this.tempo;
    this.updateBelt(dt);
    this.updateClearing(dt);
    this.updateArm(dt);
    this.sync();
  }

  private updateBelt(dt: number): void {
    const belt = this.boxes.filter((b) => b.mode === "belt").sort((a, b) => b.s - a.s);
    let limit = this.beltLength;
    for (const box of belt) {
      box.s = Math.min(box.s + BELT_SPEED * dt, limit);
      limit = box.s - SPACING;
      if (box.scale < 1) box.scale = Math.min(1, box.scale + dt / 0.35);
    }
    this.spawnIn -= dt;
    const last = belt[belt.length - 1];
    if (this.spawnIn <= 0 && belt.length < MAX_ON_BELT && (!last || last.s > SPACING)) {
      const box = this.freeBox();
      if (box) {
        box.mode = "belt";
        box.s = 0;
        box.scale = 0;
      }
      this.spawnIn = 3 + this.rand() * 3;
    }
  }

  private updateClearing(dt: number): void {
    if (!this.clearing) return;
    this.clearTime += dt;
    const k = Math.min(1, Math.max(0, 1 - this.clearTime / CLEAR_DURATION));
    for (const box of this.boxes) {
      if (box.mode !== "clearing") continue;
      box.scale = k;
      if (k === 0) box.mode = "hidden";
    }
    if (k === 0) this.clearing = false;
  }

  private updateArm(dt: number): void {
    this.elapsed += dt;
    if (this.phase === "waitBox") {
      if (this.readyBox()) this.begin("descendPick", this.pickTarget(0));
      return;
    }
    if (this.phase === "holdPlace") {
      if (!this.clearing) this.begin("descendPlace", this.slotTarget(this.slot, 0));
      return;
    }

    const u = Math.min(1, this.elapsed / DURATION[this.phase]);
    const e = easeInOut(u);
    const lift = this.phase === "toPick" || this.phase === "toPlace" ? Math.sin(Math.PI * u) * ARC : 0;
    this.tip.r = this.from.r + (this.to.r - this.from.r) * e;
    this.tip.theta = this.from.theta + (this.to.theta - this.from.theta) * e;
    this.tip.y = this.from.y + (this.to.y - this.from.y) * e + lift;
    if (u < 1) return;

    switch (this.phase) {
      case "toPick":
        if (this.readyBox()) this.begin("descendPick", this.pickTarget(0));
        else this.begin("waitBox", this.tip);
        break;
      case "descendPick": {
        const box = this.readyBox();
        if (box) {
          box.mode = "held";
          this.held = box;
        }
        this.begin("grip", this.tip);
        break;
      }
      case "grip":
        this.begin("ascendPick", this.pickTarget(HOVER));
        break;
      case "ascendPick":
        // Перенос всегда через переднюю сторону робота — так его видно с камеры.
        this.begin("toPlace", this.slotTarget(this.slot, HOVER), 1);
        break;
      case "toPlace":
        if (this.clearing) this.begin("holdPlace", this.tip);
        else this.begin("descendPlace", this.slotTarget(this.slot, 0));
        break;
      case "descendPlace":
        this.begin("release", this.tip);
        break;
      case "release": {
        const placed = this.slot;
        if (this.held) {
          this.placeBox(this.held, placed);
          this.held = null;
          this.slot += 1;
          if (this.slot >= PALLET_CAPACITY) this.startClearing();
        }
        this.begin("ascendPlace", this.slotTarget(placed, HOVER));
        break;
      }
      case "ascendPlace":
        this.begin("toPick", this.pickTarget(HOVER), -1);
        break;
    }
  }

  /** direction: 1 — поворот с увеличением угла, −1 — с уменьшением, 0 — кратчайший. */
  private begin(phase: Phase, target: Cyl, direction: -1 | 0 | 1 = 0): void {
    const theta = this.tip.theta;
    let targetTheta: number;
    if (direction > 0) targetTheta = theta + positiveAngle(target.theta - theta);
    else if (direction < 0) targetTheta = theta - positiveAngle(theta - target.theta);
    else targetTheta = theta + wrapAngle(target.theta - theta);
    this.from = { ...this.tip };
    this.to = { r: target.r, theta: targetTheta, y: target.y };
    this.phase = phase;
    this.elapsed = 0;
  }

  private startClearing(): void {
    for (const box of this.boxes) if (box.mode === "placed") box.mode = "clearing";
    this.clearing = true;
    this.clearTime = -CLEAR_DELAY;
    this.slot = 0;
  }

  private readyBox(): CellBox | undefined {
    return this.boxes.find((b) => b.mode === "belt" && b.s >= this.beltLength - 1e-3);
  }

  private freeBox(): CellBox | undefined {
    return this.boxes.find((b) => b.mode === "hidden");
  }

  private placeBox(box: CellBox, slot: number): void {
    const [ox, oz] = SLOT_OFFSETS[slot % SLOT_OFFSETS.length];
    const layer = Math.floor(slot / SLOT_OFFSETS.length);
    box.mode = "placed";
    box.x = this.layout.pallet[0] + ox;
    box.z = this.layout.pallet[1] + oz;
    box.y = PALLET_TOP + layer * CELL_BOX.h + CELL_BOX.h / 2;
    box.scale = 1;
  }

  private cyl(x: number, y: number, z: number): Cyl {
    const dx = x - this.layout.base[0];
    const dz = z - this.layout.base[1];
    return { r: Math.hypot(dx, dz), theta: Math.atan2(-dz, dx), y };
  }

  /** Точка захвата над коробкой на конце конвейера; hover — высота подъёма над ней. */
  private pickTarget(hover: number): Cyl {
    const [x, z] = this.layout.pick;
    return this.cyl(x, CONVEYOR_TOP + CELL_BOX.h + hover, z);
  }

  private slotTarget(slot: number, hover: number): Cyl {
    const [ox, oz] = SLOT_OFFSETS[slot % SLOT_OFFSETS.length];
    const layer = Math.floor(slot / SLOT_OFFSETS.length);
    const [px, pz] = this.layout.pallet;
    return this.cyl(px + ox, PALLET_TOP + (layer + 1) * CELL_BOX.h + hover, pz + oz);
  }

  private sync(): void {
    const [bx, bz] = this.layout.base;
    const dx = this.tip.r * Math.cos(this.tip.theta);
    const dz = -this.tip.r * Math.sin(this.tip.theta);
    solveArm(dx, this.tip.y, dz, this.pose);

    const [sx, sz] = this.layout.beltStart;
    for (const box of this.boxes) {
      if (box.mode === "belt") {
        box.x = sx + this.dirX * box.s;
        box.z = sz + this.dirZ * box.s;
        box.y = CONVEYOR_TOP + CELL_BOX.h / 2;
      } else if (box.mode === "held") {
        box.x = bx + dx;
        box.z = bz + dz;
        box.y = this.tip.y - CELL_BOX.h / 2;
      }
    }
  }
}
