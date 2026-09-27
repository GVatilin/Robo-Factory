/**
 * Вид 3D-модели по типу решения из каталога и габариты для превью.
 *
 * Каталог содержит десятки подтипов (AMR, «Беспилотный трактор», «ТНПА»...). Модель выбирается по коду типа,
 * затем по ключевым словам названия, затем по категории и классу изделия. Неизвестный тип — обобщённый корпус.
 */

import type { Dimensions, ProductClass } from "../../api/types";

export type RobotKind =
  | "platform"
  | "forklift"
  | "tug"
  | "cleaner"
  | "delivery"
  | "security"
  | "inventory"
  | "truck"
  | "tractor"
  | "storage"
  | "arm"
  | "mobileArm"
  | "humanoid"
  | "drone"
  | "plane"
  | "marine"
  | "software"
  | "generic";

/** Типовые габариты Д × Ш × В, мм — когда в карточке их нет. */
export const DEFAULT_DIMENSIONS: Record<RobotKind, [number, number, number]> = {
  platform: [1200, 800, 320],
  forklift: [2100, 950, 2200],
  tug: [1150, 650, 750],
  cleaner: [1150, 700, 1050],
  delivery: [560, 500, 1300],
  security: [800, 720, 1550],
  inventory: [750, 600, 2400],
  truck: [4800, 1900, 2300],
  tractor: [3800, 2000, 2800],
  storage: [3200, 2200, 2400],
  arm: [900, 900, 1900],
  mobileArm: [1100, 750, 1500],
  humanoid: [520, 320, 1700],
  drone: [1100, 1100, 420],
  plane: [1900, 3200, 480],
  marine: [3600, 1500, 1100],
  software: [560, 220, 520],
  generic: [1000, 700, 850],
};

const BY_TYPE_CODE: Record<string, RobotKind> = {
  amr: "platform",
  fmr: "forklift",
  stacker_robot: "forklift",
  autonomous_forklift: "forklift",
  tug_robot: "tug",
  autonomous_truck: "truck",
  cleaning_robot: "cleaner",
  indoor_delivery_robot: "delivery",
  security_robot: "security",
  inventory_robot: "inventory",
  picking_robot: "mobileArm",
  smart_storage: "storage",
  shuttle: "storage",
};

const BY_KEYWORD: [RegExp, RobotKind][] = [
  [/самол|vtol|крыл/, "plane"],
  // \b в JS не работает с кириллицей: границы слова для «бас» заданы явно.
  [/мультирот|коптер|ротор|(^|[^а-яё])бас([^а-яё]|$)|дрон/, "drone"],
  [/катер|катамаран|тнпа|надвод|подвод|судн|лодк|морск/, "marine"],
  [/трактор|комбайн|агро/, "tractor"],
  [/грузовик|самосвал|автомобил/, "truck"],
  [/тягач/, "tug"],
  [/погрузчик|штабел/, "forklift"],
  [/уборщ|клининг|мойк/, "cleaner"],
  [/охран|патрул/, "security"],
  [/инвентар/, "inventory"],
  [/доставщик|курьер|кафе/, "delivery"],
  [/антропоморф|гуманоид/, "humanoid"],
  [/мобильн.*манипул/, "mobileArm"],
  [/манипулятор|укладчик|паллетайз|коллаборатив|сбор плод|ячейк/, "arm"],
  [/хранени|шаттл|стеллаж|кран/, "storage"],
  [/amr|agv|тележк|платформ|ровер/, "platform"],
];

const BY_CATEGORY: Record<string, RobotKind> = {
  mobile_robots: "platform",
  autonomous_ground_vehicles: "truck",
  stationary_systems: "storage",
  manipulators: "arm",
  mobile_manipulators: "mobileArm",
  humanoid_robots: "humanoid",
  marine_robots: "marine",
  uas: "drone",
  software: "software",
};

interface TypeLike {
  code: string;
  name: string;
  category?: { code: string; name: string } | null;
}

export function resolveKind(type: TypeLike | null | undefined, productClass?: ProductClass | null): RobotKind {
  if (productClass === "software") return "software";
  if (type) {
    const byCode = BY_TYPE_CODE[type.code];
    if (byCode) return byCode;
    const name = type.name.toLowerCase();
    const byName = BY_KEYWORD.find(([pattern]) => pattern.test(name));
    if (byName) return byName[1];
    const category = type.category?.code ?? type.code;
    if (BY_CATEGORY[category]) return BY_CATEGORY[category];
  }
  if (productClass === "bas") return "drone";
  return "generic";
}

/** Габариты в метрах: длина по X, высота по Y, ширина по Z. */
export interface Size {
  l: number;
  w: number;
  h: number;
}

const clampSize = (m: number) => Math.min(40, Math.max(0.05, m));

/**
 * Размер модели по введённым габаритам. Недостающие измерения достраиваются из типовых
 * пропорционально известным, чтобы модель не искажалась. `estimated` — хотя бы одно измерение условное.
 */
export function resolveSize(kind: RobotKind, dimensions: Partial<Dimensions> | null | undefined): { size: Size; estimated: boolean } {
  const [dl, dw, dh] = DEFAULT_DIMENSIONS[kind];
  const given = [dimensions?.length_mm, dimensions?.width_mm, dimensions?.height_mm].map((v) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null,
  );
  const defaults = [dl, dw, dh];
  const known = given.map((v, i) => (v === null ? null : v / defaults[i])).filter((v): v is number => v !== null);
  const ratio = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const [l, w, h] = given.map((v, i) => clampSize((v ?? defaults[i] * ratio) / 1000));
  // Программному обеспечению габариты не нужны: показывается условный монитор.
  if (kind === "software") return { size: { l: dl / 1000, w: dw / 1000, h: dh / 1000 }, estimated: false };
  return { size: { l, w, h }, estimated: given.some((v) => v === null) };
}
