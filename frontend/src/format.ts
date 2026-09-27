const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormat.format(value);
}

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${moneyFormat.format(value)} ₽`;
}

/** 2 700 000 → «2,7 млн ₽». */
export function formatMoneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1e9) return `${compactFormat.format(value / 1e9)} млрд ₽`;
  if (value >= 1e6) return `${compactFormat.format(value / 1e6)} млн ₽`;
  if (value >= 1e3) return `${compactFormat.format(value / 1e3)} тыс. ₽`;
  return formatMoney(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/** Число из ввода пользователя: «1 500,5» → 1500.5. Пустая строка — null, мусор — NaN. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, "").replace(",", ".");
  if (!cleaned) return null;
  return /^-?\d*\.?\d+$|^-?\d+\.$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/** Число для поля ввода: 1500.5 → «1500,5». */
export function numberToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(".", ",");
}

export function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const LEGAL_FORMS = /^(ООО|АО|ПАО|ЗАО|ОАО|ИП|НПО|НПП|ГК|ФГАОУ ВО|ФГБОУ ВО|ФГУП|АНО|ГБУ)\s+/i;

/** Название компании без организационно-правовой формы и кавычек: «ООО "Ронави Роботикс"» → «Ронави Роботикс». */
export function companyShortName(name: string): string {
  let result = name.trim();
  while (LEGAL_FORMS.test(result)) result = result.replace(LEGAL_FORMS, "");
  return result.replace(/["«»“”„]/g, "").trim() || name;
}

export function initials(name: string): string {
  const words = companyShortName(name).split(/[\s-]+/).filter((w) => /[\p{L}\d]/u.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

/** Стабильный оттенок из строки — для цвета аватара производителя. */
export function hue(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Холодная часть круга (190–260°) — в тон палитре платформы.
  return 190 + (hash % 70);
}

export function formatDimensions(d: { length_mm: number | null; width_mm: number | null; height_mm: number | null }) {
  const parts = [d.length_mm, d.width_mm, d.height_mm];
  if (parts.every((v) => v === null)) return null;
  return `${parts.map((v) => (v === null ? "?" : moneyFormat.format(v))).join(" × ")} мм`;
}
