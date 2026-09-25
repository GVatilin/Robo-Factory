/**
 * Планировка склада в метрах. Ось X — вправо, Z — к зрителю, пол на высоте 0.
 *
 *   ┌──────────── задняя стена с доковыми воротами ─────────────┐
 *   │ стеллажи (3 ряда)            │ зона отгрузки с паллетами   │
 *   │══════════ главный проход ══════════════════════════════════│
 *   │  ячейки манипуляторов: конвейер → робот → паллета (×4)     │
 *   │─────────────────── пешеходная дорожка ─────────────────────│
 */

export type Point = readonly [number, number];

export const FLOOR = { width: 44, depth: 28, thickness: 0.5 } as const;
export const WALL = { height: 3.8, thickness: 0.35 } as const;

export const RACK = {
  xStart: -20,
  xEnd: -2,
  bays: 8,
  levels: [0.12, 0.95, 1.78, 2.61] as const,
  /** Высота стоек. Крыши нет: сверху видны коробки верхнего яруса. */
  top: 3.3,
  rows: [
    { z: -13.0, depth: 1.1 },
    { z: -8.35, depth: 2.2 },
    { z: -3.15, depth: 2.2 },
  ],
} as const;

export const DOCK_DOORS = [6, 10, 14, 18] as const;
export const STAGING_ROWS = [-11.3, -9.1, -6.9] as const;

export const MAIN_AISLE = { zBack: -1.85, zFront: 2.3 } as const;

export interface CellLayout {
  base: Point;
  pick: Point;
  beltStart: Point;
  pallet: Point;
}

const CELL_Z = 7.8;

/** Ячейки смещены вправо: левую часть экрана занимает текст лендинга. */
export const CELL_X = [-11, -2.5, 6, 14.5] as const;

export const CELLS: CellLayout[] = CELL_X.map((x) => ({
  base: [x, CELL_Z],
  pick: [x - 2.15, CELL_Z],
  beltStart: [x - 2.15, 3.4],
  pallet: [x + 2.05, CELL_Z],
}));

export interface WalkerLayout {
  path: Point[];
  speed: number;
  /** Начальная позиция — доля длины маршрута. */
  start: number;
  carry?: boolean;
  /** Индексы точек маршрута, где человек останавливается. */
  pauses?: number[];
}

export const WALKERS: WalkerLayout[] = [
  { path: [[-19, -0.5], [19.5, -0.5], [19.5, 0.9], [-19, 0.9]], speed: 1.25, start: 0.05 },
  { path: [[-19, -0.5], [19.5, -0.5], [19.5, 0.9], [-19, 0.9]], speed: 1.1, start: 0.55, carry: true },
  { path: [[-19.4, -10.7], [-3.2, -10.7], [-3.2, -11.2], [-19.4, -11.2]], speed: 1.0, start: 0.3, pauses: [1, 3] },
  { path: [[-19.4, -5.5], [-2.8, -5.5], [-2.8, -6.0], [-19.4, -6.0]], speed: 1.05, start: 0.7, carry: true, pauses: [3] },
  { path: [[-21, -10.95], [-21, 0.2], [-0.8, 0.2], [-0.8, -10.95]], speed: 1.2, start: 0.15 },
  { path: [[2, -4.5], [20.5, -4.5], [20.5, -5.1], [2, -5.1]], speed: 1.15, start: 0.4 },
  { path: [[8, -12.4], [8, -4.9], [12, -4.9], [12, -12.4]], speed: 1.0, start: 0.2, carry: true, pauses: [0] },
  { path: [[-20, 12.7], [20.5, 12.7], [20.5, 13.3], [-20, 13.3]], speed: 1.2, start: 0.1 },
  { path: [[-20, 12.7], [20.5, 12.7], [20.5, 13.3], [-20, 13.3]], speed: 1.05, start: 0.62, carry: true },
];

export interface StandingLayout {
  position: Point;
  /** Направление взгляда, рад (0 — к зрителю). */
  heading: number;
}

export const STANDING: StandingLayout[] = [
  { position: [CELL_X[0] - 1.9, 10.8], heading: Math.PI + 0.25 },
  { position: [CELL_X[2] - 1.9, 10.8], heading: Math.PI + 0.25 },
  { position: [CELL_X[3] - 1.7, 10.9], heading: Math.PI + 0.4 },
  { position: [7.4, -8.1], heading: -Math.PI / 2 },
  { position: [15.9, -10.2], heading: Math.PI / 2 },
  { position: [-1.5, -7.6], heading: -Math.PI / 2 + 0.2 },
];
