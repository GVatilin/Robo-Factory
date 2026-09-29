import { RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Spinner } from "../../ui/Controls";
import "./CatalogUpdates.css";

interface Report {
  checksum: string;
  applied: boolean;
  products_reviewed?: number;
  specs_added?: number;
  specs_updated?: number;
  images_updated?: number;
  fields_added?: number;
  offers_added?: number;
  sources_added?: number;
  products_created?: number;
  products_updated?: number;
  warnings?: string[];
  protected?: { product: string; spec: string }[];
  conflicts?: { product: string; code: string; source_url: string }[];
  changes?: { product_id: number; product: string; kind: string; label: string }[];
}

export function CatalogUpdates({ onUpdated }: { onUpdated: () => void }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"sources" | "csv">("sources");
  if (role !== "admin") return null;

  const run = async (apply: boolean, selectedMode = mode) => {
    setBusy(true);
    setError(null);
    try {
      let result: Report;
      if (selectedMode === "csv") {
        if (!file) throw new Error("Выберите CSV-таблицу организатора.");
        const body = new FormData();
        body.append("file", file);
        body.append("apply", String(apply));
        if (apply && report) body.append("checksum", report.checksum);
        result = await api<Report>("/catalog/updates/organizer", { method: "POST", body });
      } else {
        result = await api<Report>(`/catalog/updates/${apply ? "apply" : "preview"}`, apply
          ? { method: "POST", body: { checksum: report?.checksum } } : {});
      }
      setMode(selectedMode);
      setReport(result);
      if (apply) onUpdated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обновить каталог.");
    } finally {
      setBusy(false);
    }
  };
  const totals = report ? [
    ["Моделей проверено", report.products_reviewed], ["Новых характеристик", report.specs_added],
    ["Уточнённых характеристик", report.specs_updated], ["Фотографий", report.images_updated],
    ["Новых источников", report.sources_added], ["Полей карточек", report.fields_added],
    ["Предложений", report.offers_added], ["Новых товаров", report.products_created],
    ["Обновлённых товаров", report.products_updated],
  ].filter(([, value]) => value !== undefined) : [];
  const grouped = new Map<number, { name: string; labels: string[] }>();
  for (const change of report?.changes ?? []) {
    const entry = grouped.get(change.product_id) ?? { name: change.product, labels: [] };
    entry.labels.push(change.label);
    grouped.set(change.product_id, entry);
  }

  return <section className="catalog-updates">
    <button className="btn btn--ghost" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <RefreshCw size={16} /> Обновить каталог
    </button>
    {open && <div className="catalog-updates__panel card">
      <h2>Обновление данных</h2>
      <p>Загрузите таблицу организатора или примените подготовленное дополнение из открытых источников. Сначала посмотрите состав изменений.</p>
      <div className="catalog-updates__actions">
        <button className="btn btn--subtle" type="button" disabled={busy} onClick={() => { setReport(null); void run(false, "sources"); }}>
          <RefreshCw size={15} /> Проверить дополнение из источников
        </button>
        <label className="catalog-updates__file"><Upload size={15} /> Таблица организатора (CSV)
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
            setFile(event.target.files?.[0] ?? null); setMode("csv"); setReport(null); setError(null);
          }} />
        </label>
        {file && mode === "csv" && <button className="btn btn--subtle" type="button" disabled={busy} onClick={() => void run(false)}>Посмотреть изменения CSV</button>}
      </div>
      {busy && <Spinner label="Обрабатываем каталог…" />}
      {error && <p className="catalog-updates__error" role="alert">{error}</p>}
      {report && <div aria-live="polite">
        <h3>{report.applied ? "Изменения сохранены" : "Предварительный просмотр"}</h3>
        <dl className="catalog-updates__totals">{totals.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {!!report.protected?.length && <p>Ручные правки сохранены: {report.protected.length}.</p>}
        {!!report.conflicts?.length && <p>Расхождения с уже заполненными характеристиками: {report.conflicts.length}. Они сохранены для уточнения и автоматически не заменяют текущие значения.</p>}
        {report.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}
        {grouped.size > 0 && <details><summary>Изменения по моделям ({grouped.size})</summary><ul className="catalog-updates__list">
          {[...grouped].map(([id, entry]) => <li key={id}><Link to={`/products/${id}`}>{entry.name}</Link><span>{[...new Set(entry.labels)].join(" · ")}</span></li>)}
        </ul></details>}
        {!report.applied && <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void run(true)}>Применить показанные изменения</button>}
      </div>}
    </div>}
  </section>;
}
