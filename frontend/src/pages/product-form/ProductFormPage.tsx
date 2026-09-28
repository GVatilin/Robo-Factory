import { AlertCircle, Check, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";

import { api, ApiError } from "../../api/client";
import { useApi, useReference } from "../../api/hooks";
import type { ManufacturerSummary, Page, Product, SolutionTypeNode } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { companyShortName, parseNumber } from "../../format";
import { resolveKind, resolveSize } from "../../scene/robots/kinds";
import { usePrefersReducedMotion } from "../../scene/support";
import { ConfirmDialog, ErrorState, Notice, Spinner } from "../../ui/Controls";
import { cx } from "../../ui/Field";
import { ApplicabilitySection } from "./ApplicabilitySection";
import {
  draftFromProduct,
  draftToInput,
  emptyDraft,
  emptySpec,
  evaluateChecklist,
  sectionOfError,
  type ProductDraft,
  type SpecDraft,
} from "./draft";
import { EconomicsSection } from "./EconomicsSection";
import { FormSidebar } from "./FormSidebar";
import { IdentitySection } from "./IdentitySection";
import { PhotoSection } from "./PhotoSection";
import { SourceSection } from "./SourceSection";
import { SpecsSection } from "./SpecsSection";
import "./ProductForm.css";

const SECTIONS = [
  { id: "identity", title: "Основное", group: "identification" },
  { id: "photo", title: "Фотография", group: null },
  { id: "technical", title: "Технические характеристики", group: "technical" },
  { id: "infrastructure", title: "Инфраструктура", group: "infrastructure" },
  { id: "economics", title: "Экономика", group: "economics" },
  { id: "applicability", title: "Применимость", group: "applicability" },
  { id: "source", title: "Источник и публикация", group: null },
] as const;

const FOCUSABLE = "input:not([disabled]), textarea, select, [role=combobox], [role=radio], [role=switch], button";

function useTypeIndex(tree: SolutionTypeNode[] | undefined) {
  return useMemo(() => {
    const index = new Map<number, { node: SolutionTypeNode; category: SolutionTypeNode | null }>();
    for (const category of tree ?? []) {
      index.set(category.id, { node: category, category: null });
      for (const child of category.children) index.set(child.id, { node: child, category });
    }
    return index;
  }, [tree]);
}

export default function ProductFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const isVendor = user?.role === "vendor";
  const canPublish = can("products:publish");
  const reduced = usePrefersReducedMotion();
  const { data: reference, error: referenceError } = useReference();
  const existing = useApi<Product>(editing ? `/products/${id}` : null);
  const manufacturers = useApi<Page<ManufacturerSummary>>(isVendor ? null : "/manufacturers?limit=500&sort=name");

  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const snapshot = useRef("");
  const leaving = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [active, setActive] = useState<string>("identity");
  // Фото загружается отдельным запросом после сохранения карточки: у нового товара ещё нет id.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoError, setPhotoError] = useState<string | undefined>();

  // Черновик создаётся один раз: из загруженного товара или пустой с производителем из ссылки.
  useEffect(() => {
    if (draft) return;
    let initial: ProductDraft | null = null;
    if (editing && existing.data) initial = draftFromProduct(existing.data);
    if (!editing && user) {
      const preset = Number(params.get("manufacturer")) || null;
      initial = emptyDraft(isVendor ? (user.manufacturer?.id ?? null) : preset);
    }
    if (initial) {
      snapshot.current = JSON.stringify(initial);
      setDraft(initial);
    }
  }, [draft, editing, existing.data, user, isVendor, params]);

  const dirty = (draft !== null && JSON.stringify(draft) !== snapshot.current) || photo !== null || photoRemoved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
  );

  const clearErrors = useCallback((prefix?: string) => {
    if (!prefix) return;
    setErrors((current) => {
      const keys = Object.keys(current).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length === 0) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const patch = useCallback(
    (changes: Partial<ProductDraft>, clear?: string) => {
      setDraft((current) => (current ? { ...current, ...changes } : current));
      clearErrors(clear);
    },
    [clearErrors],
  );

  const setSpec = useCallback(
    (code: string, changes: Partial<SpecDraft>) => {
      setDraft((current) =>
        current ? { ...current, specs: { ...current.specs, [code]: { ...(current.specs[code] ?? emptySpec()), ...changes } } } : current,
      );
      clearErrors(`specs.${code}`);
    },
    [clearErrors],
  );

  const typeIndex = useTypeIndex(reference?.solutionTypes);
  const selectedType = draft?.solutionTypeId ? typeIndex.get(draft.solutionTypeId) : undefined;
  const kind = resolveKind(
    selectedType
      ? { code: selectedType.node.code, name: selectedType.node.name, category: selectedType.category }
      : null,
    draft?.productClass,
  );
  const entered = useMemo(() => {
    const read = (code: string) => {
      const value = parseNumber(draft?.specs[code]?.value ?? "");
      return value !== null && !Number.isNaN(value) && value > 0 ? value : null;
    };
    return { l: read("length_mm"), w: read("width_mm"), h: read("height_mm") };
  }, [draft?.specs]);
  const { size, estimated } = useMemo(
    () => resolveSize(kind, { length_mm: entered.l, width_mm: entered.w, height_mm: entered.h }),
    [kind, entered],
  );
  const applicableChecklist = useMemo(() => (reference?.checklist ?? []).filter(item =>
    !item.excluded_product_classes?.includes(draft?.productClass ?? "") &&
    !item.excluded_solution_types?.includes(selectedType?.node.code ?? "")),
    [reference, draft?.productClass, selectedType?.node.code]);
  const done = useMemo(
    () => (draft && reference ? evaluateChecklist(draft, applicableChecklist, reference.specs) : new Set<string>()),
    [draft, reference, applicableChecklist],
  );
  const errorSections = useMemo(
    () => new Set(Object.keys(errors).map((key) => sectionOfError(key, reference?.specs ?? []))),
    [errors, reference],
  );

  // Подсветка текущего раздела в навигации.
  const ready = Boolean(draft && reference);
  useEffect(() => {
    if (!ready) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ready]);

  const focusField = useCallback(
    (element: HTMLElement) => {
      element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      element.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      element.classList.add("is-flash");
      window.setTimeout(() => element.classList.remove("is-flash"), 1400);
    },
    [reduced],
  );

  const jump = useCallback(
    (field: string) => {
      const element = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
      if (element) focusField(element);
    },
    [focusField],
  );

  const jumpToFirstError = useCallback(
    (fieldErrors: Record<string, string>) => {
      const keys = Object.keys(fieldErrors);
      requestAnimationFrame(() => {
        const target = Array.from(document.querySelectorAll<HTMLElement>("[data-field]")).find((element) => {
          const name = element.dataset.field ?? "";
          return keys.some((key) => key === name || key.startsWith(`${name}.`));
        });
        if (target) focusField(target);
      });
    },
    [focusField],
  );

  const save = async () => {
    if (!draft || !reference) return;
    const { input, errors: local } = draftToInput(draft, reference.specs, canPublish);
    if (!input) {
      setErrors(local);
      setFormError(`Проверьте отмеченные поля: ${Object.keys(local).length}`);
      jumpToFirstError(local);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const saved = await api<Product>(editing ? `/products/${id}` : "/products", {
        method: editing ? "PUT" : "POST",
        body: input,
      });
      let photoFailure: string | null = null;
      try {
        if (photo) {
          const form = new FormData();
          form.append("file", photo);
          await api<Product>(`/products/${saved.id}/image`, { method: "PUT", body: form });
        } else if (photoRemoved && saved.image) {
          await api<Product>(`/products/${saved.id}/image`, { method: "DELETE" });
        }
      } catch (reason) {
        // Карточка уже сохранена: сообщение о фото покажет страница товара.
        photoFailure = reason instanceof ApiError ? (Object.values(reason.fields)[0] ?? reason.message) : "Сервер недоступен.";
      }
      leaving.current = true;
      navigate(`/products/${saved.id}`, { state: { flash: editing ? "updated" : "created", photoError: photoFailure } });
    } catch (reason) {
      if (reason instanceof ApiError) {
        setErrors(reason.fields);
        setFormError(reason.message);
        if (Object.keys(reason.fields).length) jumpToFirstError(reason.fields);
      } else {
        setFormError("Не удалось сохранить товар. Повторите попытку.");
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing.data) return;
    setDeleting(true);
    try {
      await api(`/products/${existing.data.id}`, { method: "DELETE" });
      leaving.current = true;
      navigate(existing.data.manufacturer ? `/manufacturers/${existing.data.manufacturer.id}` : "/manufacturers", { replace: true });
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : "Не удалось удалить товар.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  // Enter в однострочном поле не отправляет длинную форму случайно.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && target.tagName === "INPUT" && (target as HTMLInputElement).type !== "submit") event.preventDefault();
  };

  if (referenceError) return <div className="page"><ErrorState message={referenceError.message} /></div>;
  if (editing && existing.error) {
    return (
      <div className="page">
        <ErrorState message={existing.error.status === 404 ? "Товар не найден или ещё не опубликован." : existing.error.message} onRetry={existing.reload} />
      </div>
    );
  }
  if (editing && existing.data && !existing.data.can_edit) {
    return (
      <div className="page">
        <Notice tone="warning">Изменять товар может администратор или вендор компании-производителя.</Notice>
      </div>
    );
  }
  if (isVendor && !user?.manufacturer) {
    return (
      <div className="page">
        <Notice tone="warning">Учётная запись вендора не привязана к производителю. Обратитесь к администратору платформы.</Notice>
      </div>
    );
  }
  if (!reference || !draft) {
    return (
      <div className="page page--center">
        <Spinner label="Готовим форму…" />
      </div>
    );
  }

  const manufacturerName =
    (isVendor ? user?.manufacturer?.name : manufacturers.data?.items.find((m) => m.id === draft.manufacturerId)?.name) ??
    existing.data?.manufacturer?.name;
  const backLink = editing ? `/products/${id}` : draft.manufacturerId ? `/manufacturers/${draft.manufacturerId}` : "/manufacturers";
  const sectionProps = { draft, patch, setSpec, errors, reference };
  const typeIds = selectedType ? [selectedType.node.id, ...selectedType.node.children.map((c) => c.id)] : [];
  const errorCount = Object.keys(errors).length;

  return (
    <div className="page pform-page">
      <ol className="crumbs">
        <li>
          <Link to="/manufacturers">Производители</Link>
        </li>
        {draft.manufacturerId && manufacturerName && (
          <li>
            <Link to={`/manufacturers/${draft.manufacturerId}`}>{companyShortName(manufacturerName)}</Link>
          </li>
        )}
        {editing && existing.data && (
          <li>
            <Link to={`/products/${existing.data.id}`}>{existing.data.name}</Link>
          </li>
        )}
        <li aria-current="page">{editing ? "Редактирование" : "Новый товар"}</li>
      </ol>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{editing ? "Редактирование товара" : "Добавление в каталог"}</p>
          <h1>{editing ? existing.data?.name : "Новое роботизированное решение"}</h1>
          <p className="page-header__lead">
            Карточка попадёт в каталог, из которого платформа подбирает решения под объект. Чем полнее характеристики,
            тем точнее подбор и расчёт экономики.
          </p>
        </div>
      </header>

      <div className="pform">
        <nav className="pform__nav" aria-label="Разделы формы">
          <ol>
            {SECTIONS.map((section, index) => {
              const items = section.group ? applicableChecklist.filter((i) => i.group === section.group) : [];
              const filled = items.filter((i) => done.has(i.key)).length;
              const hasPhoto = photo !== null || (!photoRemoved && Boolean(existing.data?.image));
              const complete = section.id === "photo" ? hasPhoto : items.length > 0 && filled === items.length;
              const hasError = errorSections.has(section.id) || (section.id === "photo" && Boolean(photoError));
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={cx("pform__step", active === section.id && "is-active", complete && "is-complete", hasError && "has-error")}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(section.id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
                    }}
                  >
                    <span className="pform__step-index" aria-hidden="true">
                      {hasError ? <AlertCircle size={14} /> : complete ? <Check size={14} /> : index + 1}
                    </span>
                    <span className="pform__step-text">
                      {section.title}
                      {items.length > 0 && (
                        <small>
                          {filled} из {items.length}
                        </small>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <form id="product-form" className="pform__main" onSubmit={(e) => (e.preventDefault(), void save())} onKeyDown={onKeyDown} noValidate>
          {formError && (
            <Notice tone="danger" icon={<AlertCircle size={18} aria-hidden="true" />}>
              <strong>Товар не сохранён</strong>
              <span>{formError}</span>
            </Notice>
          )}
          <IdentitySection
            {...sectionProps}
            manufacturers={manufacturers.data?.items ?? null}
            lockedManufacturer={isVendor && user?.manufacturer ? user.manufacturer : null}
            canCreateManufacturer={can("manufacturers:create")}
            onReloadManufacturers={manufacturers.reload}
          />
          <PhotoSection
            current={existing.data?.image ?? null}
            pending={photo}
            removed={photoRemoved}
            error={photoError}
            isVendor={isVendor}
            onPick={(file) => {
              setPhoto(file);
              setPhotoRemoved(false);
              setPhotoError(undefined);
            }}
            onError={setPhotoError}
            onRemove={() => {
              setPhoto(null);
              setPhotoRemoved(Boolean(existing.data?.image));
              setPhotoError(undefined);
            }}
            onUndo={() => {
              setPhoto(null);
              setPhotoRemoved(false);
              setPhotoError(undefined);
            }}
          />
          <SpecsSection {...sectionProps} group="technical" />
          <SpecsSection {...sectionProps} group="infrastructure" />
          <EconomicsSection {...sectionProps} />
          <ApplicabilitySection {...sectionProps} typeIds={typeIds} />
          <SourceSection
            {...sectionProps}
            existingSources={existing.data?.sources ?? []}
            canPublish={canPublish}
            isVendor={isVendor}
            wasPublished={existing.data?.is_published ?? null}
          />
        </form>

        <aside className="pform__side">
          <FormSidebar
            kind={kind}
            size={size}
            estimated={estimated}
            typeName={selectedType?.node.name ?? null}
            entered={entered}
            checklist={applicableChecklist}
            done={done}
            onJump={jump}
            animate={!reduced}
          />
        </aside>
      </div>

      <div className="pform__bar" role="region" aria-label="Сохранение">
        <div className="pform__bar-inner">
          <div className="pform__status">
            {errorCount > 0 ? (
              <span className="pform__status-error">
                <AlertCircle size={16} aria-hidden="true" />
                Исправьте поля с ошибками: {errorCount}
              </span>
            ) : (
              <span className="pform__status-text">
                {dirty ? "Есть несохранённые изменения" : editing ? "Изменений нет" : "Заполните карточку и сохраните"}
              </span>
            )}
            {!canPublish && <span className="pform__status-note">Сохранённый товар уйдёт на проверку администратору</span>}
          </div>
          <div className="pform__bar-actions">
            {editing && (
              <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" />
                <span className="pform__bar-label">Удалить</span>
              </button>
            )}
            <Link className="btn btn--ghost" to={backLink}>
              Отмена
            </Link>
            <button type="submit" form="product-form" className="btn btn--primary" disabled={saving}>
              <Save size={17} aria-hidden="true" />
              {saving ? "Сохраняем…" : editing ? "Сохранить изменения" : canPublish && draft.isPublished ? "Добавить в каталог" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить товар?"
        confirmLabel="Удалить"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        «{existing.data?.name}» исчезнет из каталога и со страницы производителя. Действие нельзя отменить.
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Уйти без сохранения?"
        confirmLabel="Уйти"
        danger
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      >
        Изменения в карточке товара не сохранены и будут потеряны.
      </ConfirmDialog>
    </div>
  );
}
