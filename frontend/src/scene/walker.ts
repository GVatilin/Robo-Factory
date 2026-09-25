import type { WalkerLayout } from "./layout";
import { wrapAngle } from "./shared";

/** Движение человека по замкнутому маршруту с остановками. */
export class Walker {
  x = 0;
  z = 0;
  /** Направление движения, рад (0 — вдоль +Z). */
  heading = 0;
  /** Фаза шага для анимации ног и рук. */
  stride = 0;
  /** 0 — стоит, 1 — идёт; плавно меняется при остановках. */
  gait = 1;

  readonly carry: boolean;
  private readonly path: WalkerLayout["path"];
  private readonly speed: number;
  private readonly pauses: ReadonlySet<number>;
  private readonly lengths: number[];
  private readonly rand: () => number;
  private segment = 0;
  private distance = 0;
  private pause = 0;

  constructor(layout: WalkerLayout, rand: () => number) {
    this.path = layout.path;
    this.speed = layout.speed;
    this.carry = layout.carry ?? false;
    this.pauses = new Set(layout.pauses ?? []);
    this.rand = rand;
    this.lengths = this.path.map((point, i) => {
      const next = this.path[(i + 1) % this.path.length];
      return Math.hypot(next[0] - point[0], next[1] - point[1]);
    });

    let offset = layout.start * this.lengths.reduce((sum, length) => sum + length, 0);
    while (offset > this.lengths[this.segment]) {
      offset -= this.lengths[this.segment];
      this.segment = (this.segment + 1) % this.path.length;
    }
    this.distance = offset;
    this.stride = rand() * Math.PI * 2;
    this.place();
    this.heading = this.segmentHeading();
  }

  update(dt: number): void {
    if (this.pause > 0) {
      this.pause -= dt;
      this.gait = Math.max(0, this.gait - dt * 4);
      return;
    }
    this.gait = Math.min(1, this.gait + dt * 3);

    let remaining = this.speed * dt;
    while (remaining > 0) {
      const left = this.lengths[this.segment] - this.distance;
      if (remaining < left) {
        this.distance += remaining;
        break;
      }
      remaining -= left;
      this.distance = 0;
      this.segment = (this.segment + 1) % this.path.length;
      if (this.pauses.has(this.segment)) {
        this.pause = 1.2 + this.rand() * 2.2;
        break;
      }
    }
    this.place();
    this.heading += wrapAngle(this.segmentHeading() - this.heading) * Math.min(1, dt * 9);
    this.stride += dt * this.speed * 4.6;
  }

  private place(): void {
    const [ax, az] = this.path[this.segment];
    const [bx, bz] = this.path[(this.segment + 1) % this.path.length];
    const t = this.distance / this.lengths[this.segment];
    this.x = ax + (bx - ax) * t;
    this.z = az + (bz - az) * t;
  }

  private segmentHeading(): number {
    const [ax, az] = this.path[this.segment];
    const [bx, bz] = this.path[(this.segment + 1) % this.path.length];
    return Math.atan2(bx - ax, bz - az);
  }
}
