/**
 * Черновик формы товара: строки в полях ввода, преобразование в ProductInput и проверки до отправки.
 * Ключи ошибок совпадают с путями ошибок API («specs.payload_kg.value», «offers.0.monthly_fee»),
 * поэтому ошибки клиента и сервера подсвечивают одни и те же поля.
 */

import type {
  AcquisitionModel,
  ChecklistItem,
  Product,
  ProductClass,
  ProductInput,
  ReadinessStatus,
  SpecDefinition,
  SpecValueInput,
} from "../../api/types";
import { numberToInput, parseNumber } from "../../format";

export interface SpecDraft {
  value: string;
  max: string;
  text: string;
  flag: boolean | null;
  unit: string;
  confirmed: boolean;
  note: string;
  assumption: boolean;
}

export interface OfferDraft {
  key: string;
  id: number | null;
  label: string;
  model: AcquisitionModel;
  isDefault: boolean;
  vat: boolean;
  equipment: string;
  software: string;
  implementation: string;
  service: string;
  monthly: string;
  months: string;
  notes: string;
  includedServices: string;
}

export interface CaseDraft {
  key: string;
  id: number | null;
  industryId: number | null;
  scenario: string;
  description: string;
}

export interface SourceDraft {
  type: string;
  title: string;
  url: string;
  retrievedAt: string;
}

export interface ProductDraft {
  name: string;
  manufacturerId: number | null;
  solutionTypeId: number | null;
  productClass: ProductClass;
  purpose: string;
  description: string;
  country: string;
  region: string;
  readiness: ReadinessStatus | null;
  trl: number | null;
  limitations: string;
  serviceLife: string;
  isPublished: boolean;
  processIds: number[];
  specs: Record<string, SpecDraft>;
  offers: OfferDraft[];
  cases: CaseDraft[];
  source: SourceDraft;
}

let keySeq = 0;
export const newKey = () => `k${++keySeq}`;

export const emptySpec = (): SpecDraft => ({ value: "", max: "", text: "", flag: null, unit: "", confirmed: false, note: "", assumption: false });

export const emptyOffer = (model: AcquisitionModel = "purchase", isDefault = false): OfferDraft => ({
  key: newKey(),
  id: null,
  label: "",
  model,
  isDefault,
  vat: true,
  equipment: "",
  software: "",
  implementation: "",
  service: "",
  monthly: "",
  months: model === "purchase" ? "" : "36",
  notes: "",
  includedServices: "",
});

export const emptyCase = (): CaseDraft => ({ key: newKey(), id: null, industryId: null, scenario: "", description: "" });

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const emptySource = (): SourceDraft => ({ type: "manufacturer", title: "", url: "", retrievedAt: today() });

export function emptyDraft(manufacturerId: number | null): ProductDraft {
  return {
    name: "",
    manufacturerId,
    solutionTypeId: null,
    productClass: "brs",
    purpose: "",
    description: "",
    country: "Россия",
    region: "",
    readiness: null,
    trl: null,
    limitations: "",
    serviceLife: "",
    isPublished: true,
    processIds: [],
    specs: {},
    offers: [emptyOffer("purchase", true)],
    cases: [],
    source: emptySource(),
  };
}

export function draftFromProduct(product: Product): ProductDraft {
  return {
    name: product.name,
    manufacturerId: product.manufacturer?.id ?? null,
    solutionTypeId: product.solution_type?.id ?? null,
    productClass: product.product_class,
    purpose: product.purpose ?? "",
    description: product.description ?? "",
    country: product.country_of_origin ?? "",
    region: product.region ?? "",
    readiness: product.readiness_status,
    trl: product.trl,
    limitations: product.limitations ?? "",
    serviceLife: numberToInput(product.service_life_years),
    isPublished: product.is_published,
    processIds: product.processes.map((p) => p.id),
    specs: Object.fromEntries(
      product.specs.map((s) => [
        s.code,
        {
          value: numberToInput(s.value),
          max: numberToInput(s.value_max),
          text: s.text ?? "",
          flag: s.flag,
          unit: s.unit ?? "",
          confirmed: s.is_confirmed,
          note: s.note ?? "",
          assumption: s.is_assumption,
        },
      ]),
    ),
    offers: product.offers.map((o) => ({
      key: newKey(),
      id: o.id,
      label: o.label,
      model: o.acquisition_model,
      isDefault: o.is_default,
      vat: o.price_includes_vat,
      equipment: numberToInput(o.equipment_price),
      software: numberToInput(o.software_price),
      implementation: numberToInput(o.implementation_price),
      service: numberToInput(o.annual_service_cost),
      monthly: numberToInput(o.monthly_fee),
      months: numberToInput(o.min_contract_months),
      notes: o.notes ?? "",
      includedServices: o.included_services ?? "",
    })),
    cases: product.applications.map((a) => ({
      key: newKey(),
      id: a.id,
      industryId: a.industry?.id ?? null,
      scenario: a.scenario ?? "",
      description: a.case_description ?? "",
    })),
    source: emptySource(),
  };
}

const NUMERIC = new Set(["number", "integer", "range"]);

export function isSpecFilled(definition: SpecDefinition, spec: SpecDraft | undefined): boolean {
  if (!spec) return false;
  if (NUMERIC.has(definition.data_type)) {
    const low = parseNumber(spec.value);
    const high = parseNumber(spec.max);
    return (low !== null && !Number.isNaN(low)) || (high !== null && !Number.isNaN(high)) || spec.text.trim() !== "";
  }
  if (definition.data_type === "boolean") return spec.flag !== null;
  return spec.text.trim() !== "";
}

const validNumber = (text: string) => {
  const value = parseNumber(text);
  return value !== null && !Number.isNaN(value);
};

/** Выполненные пункты чек-листа полноты (ключи — как в GET /reference/product-checklist). */
export function evaluateChecklist(draft: ProductDraft, checklist: ChecklistItem[], specs: SpecDefinition[]) {
  const byCode = new Map(specs.map((s) => [s.code, s]));
  const checks: Record<string, () => boolean> = {
    "field:purpose": () => draft.purpose.trim() !== "",
    "field:country_of_origin": () => draft.country.trim() !== "",
    "field:readiness_status": () => draft.readiness !== null,
    "field:price": () => draft.offers.some((o) => validNumber(o.equipment) || validNumber(o.monthly)),
    "field:service_cost": () => draft.offers.some((o) => validNumber(o.service)),
    "field:software_cost": () => draft.offers.some((o) => validNumber(o.software)),
    "field:implementation_cost": () => draft.offers.some((o) => validNumber(o.implementation)),
    "field:service_life_years": () => validNumber(draft.serviceLife),
    "field:processes": () => draft.processIds.length > 0 || draft.cases.some(c => c.scenario.trim() !== ""),
    "field:limitations": () => draft.limitations.trim() !== "",
  };
  const done = new Set<string>();
  for (const item of checklist) {
    const [kind, name] = item.key.split(":");
    const definition = byCode.get(name);
    const ok = kind === "spec" ? definition !== undefined && isSpecFilled(definition, draft.specs[name]) : (checks[item.key]?.() ?? false);
    if (ok) done.add(item.key);
  }
  return done;
}

/** Поле формы, к которому ведёт пункт чек-листа (атрибут data-field). */
export function checklistField(key: string): string {
  const [kind, name] = key.split(":");
  if (kind === "spec") return `specs.${name}`;
  return (
    {
      purpose: "purpose",
      country_of_origin: "country_of_origin",
      readiness_status: "readiness_status",
      price: "offers",
      service_cost: "offers",
      software_cost: "offers",
      implementation_cost: "offers",
      service_life_years: "service_life_years",
      processes: "process_ids",
      limitations: "limitations",
    }[name] ?? name
  );
}

interface NumberRule {
  integer?: boolean;
  negative?: boolean;
  max?: number;
}

export function draftToInput(
  draft: ProductDraft,
  definitions: SpecDefinition[],
  canPublish: boolean,
): { input: ProductInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const num = (text: string, key: string, rule: NumberRule = {}): number | null => {
    const value = parseNumber(text);
    if (value === null) return null;
    if (Number.isNaN(value)) errors[key] = "Введите число, например 1500 или 1,5";
    else if (!rule.negative && value < 0) errors[key] = "Значение не может быть отрицательным";
    else if (rule.integer && !Number.isInteger(value)) errors[key] = "Введите целое число";
    else if (rule.max !== undefined && value > rule.max) errors[key] = `Значение должно быть не больше ${rule.max}`;
    else return value;
    return null;
  };
  const text = (value: string) => value.trim() || null;

  const name = draft.name.trim();
  if (!name) errors.name = "Укажите наименование товара";
  else if (name.length < 2) errors.name = "Наименование — не короче 2 символов";
  if (draft.manufacturerId === null) errors.manufacturer_id = "Выберите производителя";
  if (draft.solutionTypeId === null) errors.solution_type_id = "Выберите тип решения";
  const serviceLife = num(draft.serviceLife, "service_life_years", { max: 50 });

  const specs: SpecValueInput[] = [];
  for (const definition of definitions) {
    const spec = draft.specs[definition.code];
    if (!spec) continue;
    const key = `specs.${definition.code}`;
    const base = {
      code: definition.code,
      value: null,
      value_max: null,
      text: text(spec.text),
      flag: null,
      is_confirmed: spec.confirmed,
      note: text(spec.note),
      is_assumption: spec.assumption,
    };
    const unit = definition.unit ? null : text(spec.unit);
    if (NUMERIC.has(definition.data_type)) {
      const rule = { integer: definition.data_type === "integer", negative: definition.unit === "°C" };
      const low = num(spec.value, `${key}.value`, rule);
      const high = definition.data_type === "range" ? num(spec.max, `${key}.value_max`, rule) : null;
      if (low === null && high === null && base.text === null) continue;
      if (low !== null && high !== null && high < low) errors[`${key}.value_max`] = "Верхняя граница меньше нижней";
      specs.push({ ...base, value: low, value_max: high, unit });
    } else if (definition.data_type === "boolean") {
      if (spec.flag === null) continue;
      specs.push({ ...base, flag: spec.flag, unit });
    } else {
      if (!spec.text.trim()) continue;
      specs.push({ ...base, text: spec.text.trim(), unit });
    }
  }

  const offers = draft.offers.map((offer, index) => {
    const key = `offers.${index}`;
    return {
      id: offer.id,
      label: text(offer.label),
      acquisition_model: offer.model,
      is_default: offer.isDefault,
      price_includes_vat: offer.vat,
      equipment_price: num(offer.equipment, `${key}.equipment_price`),
      software_price: num(offer.software, `${key}.software_price`),
      implementation_price: num(offer.implementation, `${key}.implementation_price`),
      annual_service_cost: num(offer.service, `${key}.annual_service_cost`),
      monthly_fee: offer.model === "purchase" ? null : num(offer.monthly, `${key}.monthly_fee`),
      min_contract_months: offer.model === "purchase" ? null : num(offer.months, `${key}.min_contract_months`, { integer: true, max: 240 }),
      notes: text(offer.notes),
      included_services: text(offer.includedServices),
    };
  });

  const url = draft.source.url.trim();
  if (url && (!url.includes(".") || /\s/.test(url))) errors["source.url"] = "Укажите ссылку, например https://example.ru/robot.pdf";

  if (Object.keys(errors).length || draft.manufacturerId === null || draft.solutionTypeId === null) {
    return { input: null, errors };
  }
  return {
    errors,
    input: {
      name,
      manufacturer_id: draft.manufacturerId,
      solution_type_id: draft.solutionTypeId,
      product_class: draft.productClass,
      purpose: text(draft.purpose),
      description: text(draft.description),
      country_of_origin: text(draft.country),
      region: text(draft.region),
      readiness_status: draft.readiness,
      trl: draft.trl,
      limitations: text(draft.limitations),
      service_life_years: serviceLife,
      is_published: canPublish ? draft.isPublished : null,
      process_ids: draft.processIds,
      specs,
      offers,
      applications: draft.cases.map((c) => ({
        id: c.id,
        industry_id: c.industryId,
        scenario: text(c.scenario),
        case_description: text(c.description),
      })),
      source:
        draft.source.title.trim() || url
          ? { source_type: draft.source.type, title: text(draft.source.title), url: url || null, retrieved_at: draft.source.retrievedAt || null }
          : { source_type: draft.source.type, title: null, url: null, retrieved_at: draft.source.retrievedAt || null },
    },
  };
}

/** Раздел формы по ключу ошибки: для навигации и подсветки разделов. */
export function sectionOfError(key: string, definitions: SpecDefinition[]): string {
  if (key.startsWith("specs.")) {
    const code = key.split(".")[1];
    return definitions.find((d) => d.code === code)?.group === "infrastructure" ? "infrastructure" : "technical";
  }
  if (key.startsWith("offers") || key === "service_life_years") return "economics";
  if (key.startsWith("applications") || key === "process_ids" || key === "limitations") return "applicability";
  if (key.startsWith("source") || key === "is_published") return "source";
  return "identity";
}
