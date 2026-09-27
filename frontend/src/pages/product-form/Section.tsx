import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ReferenceData } from "../../api/hooks";
import type { ProductDraft, SpecDraft } from "./draft";

export interface SectionProps {
  draft: ProductDraft;
  /** Меняет черновик и снимает ошибки полей, путь которых начинается с clear. */
  patch: (changes: Partial<ProductDraft>, clear?: string) => void;
  setSpec: (code: string, changes: Partial<SpecDraft>) => void;
  errors: Record<string, string>;
  reference: ReferenceData;
}

interface SectionShellProps {
  id: string;
  icon: LucideIcon;
  title: string;
  lead?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

export function SectionShell({ id, icon: Icon, title, lead, aside, children }: SectionShellProps) {
  return (
    <section id={id} className="fsection card" aria-labelledby={`${id}-title`}>
      <header className="fsection__head">
        <span className="fsection__icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="fsection__titles">
          <h2 id={`${id}-title`}>{title}</h2>
          {lead && <p>{lead}</p>}
        </div>
        {aside && <div className="fsection__aside">{aside}</div>}
      </header>
      <div className="fsection__body">{children}</div>
    </section>
  );
}

/** Примеры значений и подсказки к характеристикам справочника (п. 4.5.3 ТЗ). */
export const SPEC_HINTS: Record<string, { placeholder?: string; placeholderMax?: string; hint?: string }> = {
  payload_kg: { placeholder: "1500", hint: "Максимальная масса перевозимого груза" },
  weight_kg: { placeholder: "450", hint: "Собственная масса без груза" },
  max_speed_mps: { placeholder: "1,5", hint: "1 м/с = 3,6 км/ч" },
  throughput: { placeholder: "40", placeholderMax: "60", hint: "Укажите единицу: паллет/ч, заказов/ч, м²/ч" },
  runtime_h: { placeholder: "8", placeholderMax: "10", hint: "От одной зарядки; диапазон — для разных режимов" },
  charge_time_h: { placeholder: "1,5", hint: "Полная зарядка АКБ" },
  positioning_accuracy_mm: { placeholder: "10", hint: "Точность остановки у точки операции, ±мм" },
  navigation_type: { placeholder: "Лидарный SLAM, QR-коды на полу" },
  operating_temp_c: { placeholder: "−10", placeholderMax: "45", hint: "Минимальная и максимальная температура" },
  operating_conditions: { placeholder: "Отапливаемый склад, влажность до 80%" },
  lift_height_mm: { placeholder: "3000", hint: "Для штабелёров и погрузчиков" },
  cleaning_width_mm: { placeholder: "550", placeholderMax: "700", hint: "Для роботов-уборщиков" },
  tank_volume_l: { placeholder: "70" },
  battery_capacity_kwh: { placeholder: "2,4", hint: "Нужна для расчёта затрат на электроэнергию" },
  range_km: { placeholder: "20", placeholderMax: "30" },
  noise_dba: { placeholder: "60" },
  min_aisle_width_mm: { placeholder: "1200", hint: "Ширина прохода для движения и разворота с грузом" },
  floor_requirements: { placeholder: "Ровный бетонный пол, перепад до 5 мм на 2 м" },
  charging_infrastructure: { placeholder: "Автоматическая зарядная станция 220 В, одна на 5 роботов" },
  connectivity: { placeholder: "Wi-Fi 5 ГГц по всей зоне работы" },
  integration: { placeholder: "REST API, коннекторы к WMS и 1С" },
  service_requirements: { placeholder: "ТО раз в 6 месяцев, сервисный центр в РФ" },
  elevator_integration: { hint: "Робот вызывает лифт и перемещается между этажами" },
};

export const THROUGHPUT_UNITS = ["паллет/ч", "заказов/ч", "строк/ч", "отправлений/ч", "рейсов/ч", "м²/ч", "кг/ч"];
