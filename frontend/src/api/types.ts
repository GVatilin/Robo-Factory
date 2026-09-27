/** Типы ответов и запросов API /api/v1 (зеркало схем backend/app/schemas). */

export type Role = "guest" | "user" | "vendor" | "admin";

export type Permission =
  | "catalog:read"
  | "projects:manage"
  | "products:manage"
  | "products:manage_own"
  | "products:publish"
  | "manufacturers:create"
  | "manufacturers:manage"
  | "manufacturers:manage_own"
  | "users:manage";

export interface Ref {
  id: number;
  name: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Option {
  value: string;
  label: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  organization: string | null;
  role: Exclude<Role, "guest">;
  is_active: boolean;
  manufacturer: Ref | null;
  permissions: Permission[];
  created_at: string;
  last_login_at: string | null;
}

export interface RoleInfo {
  code: Role;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ---------- справочники ----------

export interface SolutionTypeNode {
  id: number;
  code: string;
  name: string;
  description: string | null;
  children: SolutionTypeNode[];
}

export type SpecGroup = "technical" | "infrastructure" | "economics" | "applicability";
export type ValueDataType = "number" | "integer" | "string" | "boolean" | "enum" | "dimensions" | "range";

export interface SpecDefinition {
  id: number;
  code: string;
  name: string;
  group: SpecGroup;
  unit: string | null;
  data_type: ValueDataType;
  is_mandatory: boolean;
  is_filterable: boolean;
  description: string | null;
}

export interface FacilityType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  industry: Ref;
  processes: { id: number; code: string; name: string; solution_type_ids: number[] }[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  group: string;
}

export interface CatalogOptions {
  product_classes: Option[];
  readiness_statuses: Option[];
  acquisition_models: Option[];
  source_types: Option[];
  spec_groups: Option[];
}

// ---------- каталог ----------

export type ProductClass = "brs" | "bas" | "software";
export type ReadinessStatus = "operation" | "piloting" | "rnd";
export type AcquisitionModel = "purchase" | "lease" | "raas";

export interface SolutionTypeRef {
  id: number;
  code: string;
  name: string;
  category: SolutionTypeRef | null;
}

export interface Dimensions {
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
}

export interface ProductImage {
  url: string;
  thumb_url: string;
  width: number;
  height: number;
  source: Source | null;
  uploaded_at: string;
}

export interface ProductSummary {
  id: number;
  name: string;
  /** Превью фотографии для карточки. */
  image_url: string | null;
  manufacturer: Ref | null;
  solution_type: SolutionTypeRef | null;
  product_class: ProductClass;
  readiness_status: ReadinessStatus | null;
  purpose: string | null;
  country_of_origin: string | null;
  is_published: boolean;
  price_from: number | null;
  monthly_fee_from: number | null;
  acquisition_models: AcquisitionModel[];
  dimensions: Dimensions;
  payload_kg: number | null;
  max_speed_mps: number | null;
  completeness_percent: number;
  updated_at: string;
}

export interface Source {
  id: number;
  title: string;
  source_type: string;
  url: string | null;
  publisher: string | null;
  retrieved_at: string | null;
}

export interface SpecValue {
  code: string;
  name: string;
  group: SpecGroup;
  data_type: ValueDataType;
  unit: string | null;
  is_mandatory: boolean;
  value: number | null;
  value_max: number | null;
  text: string | null;
  flag: boolean | null;
  is_confirmed: boolean;
  is_assumption: boolean;
  note: string | null;
  source: Source | null;
  retrieved_at: string | null;
}

export interface Offer {
  id: number;
  label: string;
  acquisition_model: AcquisitionModel;
  is_default: boolean;
  currency: string;
  price_includes_vat: boolean;
  equipment_price: number | null;
  software_price: number | null;
  implementation_price: number | null;
  annual_service_cost: number | null;
  monthly_fee: number | null;
  min_contract_months: number | null;
  included_services: string | null;
  is_confirmed: boolean;
  notes: string | null;
  source: Source | null;
}

export interface Application {
  id: number;
  industry: Ref | null;
  scenario: string | null;
  case_description: string | null;
}

export interface ProcessInfo {
  id: number;
  code: string;
  name: string;
  facility_type: { id: number; code: string; name: string };
}

export interface Product extends ProductSummary {
  external_id: string | null;
  description: string | null;
  region: string | null;
  trl: number | null;
  market_potential: number | null;
  limitations: string | null;
  service_life_years: number | null;
  last_verified_at: string | null;
  created_at: string;
  specs: SpecValue[];
  offers: Offer[];
  applications: Application[];
  processes: ProcessInfo[];
  sources: Source[];
  completeness: { percent: number; filled: number; total: number; missing: string[] };
  image: ProductImage | null;
  can_edit: boolean;
  can_publish: boolean;
}

export interface ManufacturerSummary {
  id: number;
  name: string;
  country: string | null;
  region: string | null;
  website: string | null;
  product_count: number;
  pending_count: number;
  solution_types: string[];
  updated_at: string;
}

export interface Manufacturer extends ManufacturerSummary {
  contact_email: string | null;
  phone: string | null;
  description: string | null;
  created_at: string;
  can_edit: boolean;
  can_add_products: boolean;
  can_delete: boolean;
  products: ProductSummary[];
}

export interface ManufacturerInput {
  name: string;
  country: string | null;
  region: string | null;
  website: string | null;
  contact_email: string | null;
  phone: string | null;
  description: string | null;
}

export interface SpecValueInput {
  code: string;
  value: number | null;
  value_max: number | null;
  text: string | null;
  flag: boolean | null;
  unit: string | null;
  is_confirmed: boolean;
}

export interface OfferInput {
  id: number | null;
  label: string | null;
  acquisition_model: AcquisitionModel;
  is_default: boolean;
  price_includes_vat: boolean;
  equipment_price: number | null;
  software_price: number | null;
  implementation_price: number | null;
  annual_service_cost: number | null;
  monthly_fee: number | null;
  min_contract_months: number | null;
}

export interface ApplicationInput {
  id: number | null;
  industry_id: number | null;
  scenario: string | null;
  case_description: string | null;
}

export interface ProductInput {
  name: string;
  manufacturer_id: number;
  solution_type_id: number;
  product_class: ProductClass;
  purpose: string | null;
  description: string | null;
  country_of_origin: string | null;
  region: string | null;
  readiness_status: ReadinessStatus | null;
  trl: number | null;
  limitations: string | null;
  service_life_years: number | null;
  is_published: boolean | null;
  process_ids: number[];
  specs: SpecValueInput[];
  offers: OfferInput[];
  applications: ApplicationInput[];
  source: { source_type: string; title: string | null; url: string | null; retrieved_at: string | null } | null;
}

// ---------- каталог решений ----------

export interface TreeNode {
  key: string;
  kind: "industry" | "facility" | "process" | "solution_type" | "other";
  name: string;
  count: number;
  params: Record<string, number | boolean>;
  children: TreeNode[];
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  group: string | null;
}

export interface CatalogFacets {
  solution_types: FacetValue[];
  product_classes: FacetValue[];
  readiness_statuses: FacetValue[];
  countries: FacetValue[];
  acquisition_models: FacetValue[];
  with_image: number;
  with_cases: number;
}

export interface CatalogItem extends ProductSummary {
  unknown: string[];
}

export interface CatalogPage {
  items: CatalogItem[];
  total: number;
  limit: number;
  offset: number;
  facets: CatalogFacets | null;
}

export interface SpecFilterInfo {
  code: string;
  name: string;
  group: SpecGroup;
  unit: string | null;
  data_type: ValueDataType;
  operator: ">=" | "<=" | "~" | "=" | "range";
  count: number;
  min: number | null;
  max: number | null;
  suggestions: string[];
}

export interface CatalogFilterInfo {
  specs: SpecFilterInfo[];
  price_min: number | null;
  price_max: number | null;
  total: number;
}

export interface CompareCell {
  value?: number | null;
  value_max?: number | null;
  text?: string | null;
  items?: string[] | null;
  flag?: boolean | null;
  unit?: string | null;
  confirmed?: boolean | null;
  note?: string | null;
}

export interface CompareRow {
  key: string;
  label: string;
  kind: "number" | "money" | "percent" | "text" | "list" | "bool" | "date";
  unit: string | null;
  better: "higher" | "lower" | null;
  mandatory: boolean;
  hint: string | null;
  cells: CompareCell[];
  best: number[];
  differs: boolean;
}

export interface CompareGroup {
  key: string;
  title: string;
  description: string | null;
  rows: CompareRow[];
}

export interface Comparison {
  products: ProductSummary[];
  groups: CompareGroup[];
  missing: number[];
}
