import { Camera, ImagePlus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import type { ProductImage } from "../../api/types";
import { formatDate } from "../../format";
import { Notice } from "../../ui/Controls";
import { cx, Field } from "../../ui/Field";
import { SectionShell } from "./Section";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_MAX_MB = 10;

/** Проверка до отправки: тип и размер. Содержимое файла проверяет сервер. */
export function checkPhoto(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return "Выберите фотографию в формате JPEG, PNG или WebP.";
  if (file.size > PHOTO_MAX_MB * 1024 * 1024) return `Файл больше ${PHOTO_MAX_MB} МБ. Уменьшите фотографию и выберите снова.`;
  return null;
}

interface PhotoSectionProps {
  current: ProductImage | null;
  pending: File | null;
  removed: boolean;
  error?: string;
  isVendor: boolean;
  onPick: (file: File) => void;
  onError: (message: string) => void;
  onRemove: () => void;
  onUndo: () => void;
}

export function PhotoSection({ current, pending, removed, error, isVendor, onPick, onError, onRemove, onUndo }: PhotoSectionProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!pending) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(pending);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = checkPhoto(file);
    if (problem) onError(problem);
    else onPick(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  };

  const shown = preview ?? (!removed ? current?.url : null) ?? null;
  const status = pending
    ? `Новое фото: ${pending.name}. Загрузится при сохранении карточки.`
    : removed
      ? "Фото будет удалено при сохранении карточки."
      : current
        ? `${current.source?.title ?? "Загружено"} · ${formatDate(current.uploaded_at)}`
        : null;

  return (
    <SectionShell
      id="photo"
      icon={Camera}
      title="Фотография"
      lead="Показывается в каталоге, на странице производителя и в карточке товара рядом с 3D-моделью."
    >
      <Field label="Фотография товара" name="photo" error={error}>
        <div
          className={cx("photo-drop", dragging && "is-dragging", shown && "has-image", error && "photo-drop--invalid")}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {shown ? (
            <img className="photo-drop__image" src={shown} alt="Фотография товара" />
          ) : (
            <button type="button" className="photo-drop__empty" onClick={() => input.current?.click()}>
              <span className="photo-drop__icon">
                <ImagePlus size={24} aria-hidden="true" />
              </span>
              <strong>Перетащите фотографию сюда или выберите файл</strong>
              <span>JPEG, PNG или WebP до {PHOTO_MAX_MB} МБ</span>
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Выбрать фотографию"
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </Field>
      <div className="photo-actions">
        {status && <span className="photo-actions__status">{status}</span>}
        <div className="photo-actions__buttons">
          {(pending || removed) && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onUndo}>
              <Undo2 size={15} aria-hidden="true" />
              Отменить
            </button>
          )}
          {shown && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => input.current?.click()}>
              <RefreshCw size={15} aria-hidden="true" />
              Заменить
            </button>
          )}
          {shown && (
            <button type="button" className="btn btn--danger-ghost btn--sm" onClick={onRemove}>
              <Trash2 size={15} aria-hidden="true" />
              Удалить
            </button>
          )}
        </div>
      </div>
      <p className="field__hint">
        Метаданные снимка (EXIF, геометка) удаляются, большие фотографии уменьшаются до 1600 px. Лучше всего подходит
        снимок товара на светлом или прозрачном фоне.
      </p>
      {isVendor && (pending || removed) && (
        <Notice tone="warning">Новое фото, как и другие изменения карточки, отправит товар на проверку администратору.</Notice>
      )}
    </SectionShell>
  );
}
