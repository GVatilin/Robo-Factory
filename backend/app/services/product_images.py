"""Фотографии товаров: проверка файла, нормализация и хранение на диске.

Загруженный файл декодируется Pillow и сохраняется заново в WebP. Так отбрасываются EXIF (геометка,
модель камеры), файл другого типа под видом картинки не проходит, а большие снимки уменьшаются.
Рядом с изображением хранится превью для карточек каталога.
"""

import struct
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

# MPO — JPEG с несколькими кадрами, так сохраняют снимки некоторые телефоны.
ACCEPTED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
MAX_PIXELS = 40_000_000
WEBP_QUALITY = 86

EMR_EOF = 14
EMR_SETDIBITSTODEVICE = 80
EMR_STRETCHDIBITS = 81


class ImageError(ValueError):
    """Файл нельзя принять как фотографию товара. Текст ошибки показывается пользователю."""


def images_dir() -> Path:
    return settings.upload_dir / "products"


def image_path(image_id: uuid.UUID, *, thumb: bool = False) -> Path:
    return images_dir() / f"{image_id}{'_thumb' if thumb else ''}.webp"


def prepare(image: Image.Image) -> Image.Image:
    """Поворот по EXIF и приведение к RGB или RGBA; непрозрачная альфа отбрасывается."""
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "RGBA"):
        transparent = "A" in image.getbands() or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if transparent else "RGB")
    if image.mode == "RGBA" and image.getextrema()[3][0] == 255:
        image = image.convert("RGB")
    return image


def decode_upload(content: bytes) -> Image.Image:
    """Проверяет загруженный файл и возвращает изображение. Ошибки — ImageError с понятным текстом."""
    if not content:
        raise ImageError("Файл пустой. Выберите фотографию.")
    if len(content) > settings.max_image_mb * 1024 * 1024:
        raise ImageError(f"Файл больше {settings.max_image_mb} МБ. Уменьшите фотографию и загрузите снова.")
    try:
        with Image.open(BytesIO(content)) as probe:
            if probe.format not in ACCEPTED_FORMATS:
                raise ImageError("Поддерживаются фотографии в форматах JPEG, PNG и WebP.")
            if probe.width * probe.height > MAX_PIXELS:
                raise ImageError("Слишком большое разрешение: не более 40 мегапикселей.")
            probe.verify()
        image = Image.open(BytesIO(content))
        image.load()
        return prepare(image)
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageError("Не удалось прочитать изображение. Загрузите фотографию в формате JPEG, PNG или WebP.") from exc


def emf_bitmap(data: bytes) -> Image.Image:
    """Растровое изображение из EMF-метафайла.

    Word сохраняет вставленные фотографии как EMF с записью EMR_STRETCHDIBITS, внутри которой лежит DIB.
    Берётся самый крупный растровый блок; векторные EMF без растра не поддерживаются.
    """
    best: tuple[bytes, bytes] | None = None
    offset = 0
    while offset + 8 <= len(data):
        record_type, size = struct.unpack_from("<II", data, offset)
        if size < 8 or offset + size > len(data):
            break
        if record_type in (EMR_STRETCHDIBITS, EMR_SETDIBITSTODEVICE) and size >= 76:
            # После типа и размера: rclBounds (4 int), 6 int координат, затем смещения и размеры BMI и битов.
            off_bmi, cb_bmi, off_bits, cb_bits = struct.unpack_from("<4I", data, offset + 48)
            record = data[offset : offset + size]
            if cb_bmi and cb_bits and off_bits + cb_bits <= size and (best is None or cb_bits > len(best[1])):
                best = (record[off_bmi : off_bmi + cb_bmi], record[off_bits : off_bits + cb_bits])
        if record_type == EMR_EOF:
            break
        offset += size
    if best is None:
        raise ImageError("В EMF нет растрового изображения.")

    bmi, bits = best
    _, width, height, _, bpp, compression = struct.unpack_from("<IiiHHI", bmi, 0)
    if bpp == 32 and compression == 0 and len(bits) >= width * abs(height) * 4:
        # 32 бит без сжатия: четвёртый байт — альфа, если в нём есть данные, иначе заполнитель.
        alpha = bits[3::4]
        raw = "BGRA" if min(alpha) != max(alpha) else "BGRX"
        image = Image.frombuffer(
            "RGBA" if raw == "BGRA" else "RGB", (width, abs(height)), bits, "raw", raw, width * 4, -1 if height > 0 else 1
        )
        return prepare(image.copy())
    # Остальные варианты DIB (палитры, 24 бит, RLE) разбирает BMP-декодер Pillow.
    file_header = b"BM" + struct.pack("<IHHI", 14 + len(bmi) + len(bits), 0, 0, 14 + len(bmi))
    try:
        image = Image.open(BytesIO(file_header + bmi + bits))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageError("Не удалось прочитать растр внутри EMF.") from exc
    return prepare(image)


def _fit(image: Image.Image, side: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((side, side), Image.Resampling.LANCZOS)
    return copy


def _save(image: Image.Image, path: Path) -> int:
    temporary = path.with_suffix(".tmp")
    image.save(temporary, "WEBP", quality=WEBP_QUALITY, method=5)
    temporary.replace(path)
    return path.stat().st_size


def write_files(image: Image.Image, image_id: uuid.UUID) -> tuple[int, int, int]:
    """Сохраняет изображение и превью. Возвращает ширину, высоту и размер основного файла."""
    images_dir().mkdir(parents=True, exist_ok=True)
    full = _fit(image, settings.image_max_side)
    size = _save(full, image_path(image_id))
    _save(_fit(image, settings.image_thumb_side), image_path(image_id, thumb=True))
    return full.width, full.height, size


def remove_files(*image_ids: uuid.UUID) -> None:
    for image_id in image_ids:
        for thumb in (False, True):
            image_path(image_id, thumb=thumb).unlink(missing_ok=True)
