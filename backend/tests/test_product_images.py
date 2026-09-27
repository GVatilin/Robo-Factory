import struct
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from app.core.config import settings
from app.services.product_images import ImageError, decode_upload, emf_bitmap, image_path, remove_files, write_files
from app.services.solution_examples import ExamplesDocumentError, parse_examples_docx

DOCX = Path(__file__).resolve().parents[2] / "datasets" / "Примеры_решений_типы_объектов.docx"


def png_bytes(size=(40, 30), color=(200, 30, 30), mode="RGB", fmt="PNG", **save) -> bytes:
    buffer = BytesIO()
    Image.new(mode, size, color).save(buffer, fmt, **save)
    return buffer.getvalue()


def make_emf(width: int, height: int, pixels_bgra: bytes) -> bytes:
    """EMF из заголовка, одной записи EMR_STRETCHDIBITS с 32-битным DIB (снизу вверх) и EMR_EOF."""
    bmi = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 32, 0, len(pixels_bgra), 0, 0, 0, 0)
    fixed = 80
    record = struct.pack(
        "<II4i6i4I2I2i",
        81, fixed + len(bmi) + len(pixels_bgra), 0, 0, width, height,
        0, 0, 0, 0, width, height, fixed, len(bmi), fixed + len(bmi), len(pixels_bgra), 0, 0x00CC0020, width, height,
    ) + bmi + pixels_bgra
    header = struct.pack("<II", 1, 88) + bytes(80)
    eof = struct.pack("<II", 14, 20) + bytes(12)
    return header + record + eof


def test_emf_bitmap_reads_bottom_up_dib():
    # Нижняя строка (первая в DIB) — синяя, верхняя — красная; четвёртый байт — заполнитель.
    blue, red = bytes([255, 0, 0, 0]), bytes([0, 0, 255, 0])
    image = emf_bitmap(make_emf(2, 2, blue * 2 + red * 2))
    assert image.mode == "RGB" and image.size == (2, 2)
    assert image.getpixel((0, 0)) == (255, 0, 0)
    assert image.getpixel((1, 1)) == (0, 0, 255)


def test_emf_without_bitmap_is_rejected():
    with pytest.raises(ImageError, match="растрового"):
        emf_bitmap(struct.pack("<II", 1, 88) + bytes(80) + struct.pack("<II", 14, 20) + bytes(12))


def test_decode_upload_rejects_bad_files(monkeypatch):
    with pytest.raises(ImageError, match="пустой"):
        decode_upload(b"")
    with pytest.raises(ImageError, match="Не удалось прочитать"):
        decode_upload(b"%PDF-1.7 not an image")
    with pytest.raises(ImageError, match="JPEG, PNG и WebP"):
        decode_upload(png_bytes(fmt="GIF"))
    monkeypatch.setattr(settings, "max_image_mb", 0)
    with pytest.raises(ImageError, match="больше 0 МБ"):
        decode_upload(png_bytes())


def test_upload_is_reencoded_without_exif_and_resized(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    exif = Image.Exif()
    exif[0x010F] = "Camera maker"
    image = decode_upload(png_bytes(size=(3200, 1600), fmt="JPEG", exif=exif))
    image_id = __import__("uuid").uuid4()
    width, height, size = write_files(image, image_id)
    assert (width, height) == (settings.image_max_side, settings.image_max_side // 2)
    with Image.open(image_path(image_id)) as saved:
        assert saved.format == "WEBP" and not saved.getexif()
        assert size == image_path(image_id).stat().st_size
    with Image.open(image_path(image_id, thumb=True)) as thumb:
        assert max(thumb.size) == settings.image_thumb_side
    remove_files(image_id)
    assert not image_path(image_id).exists() and not image_path(image_id, thumb=True).exists()


def test_opaque_alpha_is_dropped_transparency_kept():
    assert decode_upload(png_bytes(mode="RGBA", color=(1, 2, 3, 255))).mode == "RGB"
    assert decode_upload(png_bytes(mode="RGBA", color=(1, 2, 3, 0))).mode == "RGBA"


def make_docx(rows: list[list[str]], images: dict[str, bytes]) -> bytes:
    """Документ с одной таблицей: ячейка «IMG:rId» — картинка, иначе — текст подписи."""
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    a = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    r = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

    def cell(value: str) -> str:
        if value.startswith("IMG:"):
            return f'<w:tc><w:p><w:r><w:drawing><a:blip r:embed="{value[4:]}"/></w:drawing></w:r></w:p></w:tc>'
        return f"<w:tc><w:p><w:r><w:t>{value}</w:t></w:r></w:p><w:p><w:r><w:t>ТТХ:</w:t></w:r></w:p></w:tc>"

    table = "".join("<w:tr>" + "".join(cell(v) for v in row) + "</w:tr>" for row in rows)
    document = (
        f"<w:document {w} {a} {r}><w:body><w:p><w:r><w:t>ПРИМЕРЫ РЕШЕНИЙ В РОБОТИЗАЦИИ СКЛАДА</w:t></w:r></w:p>"
        f"<w:tbl>{table}</w:tbl></w:body></w:document>"
    )
    rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(
        f'<Relationship Id="{rid}" Target="media/{rid}.png"/>' for rid in images
    ) + "</Relationships>"
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", rels)
        for rid, data in images.items():
            archive.writestr(f"word/media/{rid}.png", data)
    return buffer.getvalue()


def test_docx_photos_pair_with_captions_in_order():
    content = make_docx(
        [
            ["IMG:r1", "IMG:r2"],
            ["AMR (на примере модели Ronavi H1500)", "FMR (на примере DMR Carrier P)"],
            ["IMG:r3", "Робот-уборщик (на примере модели Ronavi H1500)"],
        ],
        {"r1": png_bytes(), "r2": png_bytes(), "r3": png_bytes()},
    )
    photos, warnings = parse_examples_docx(content)
    assert warnings == []
    # Повтор модели в другом разделе документа не создаёт второго фото.
    assert [(p.model, p.kind, p.media) for p in photos] == [
        ("Ronavi H1500", "AMR", "word/media/r1.png"),
        ("DMR Carrier P", "FMR", "word/media/r2.png"),
    ]
    assert photos[0].section == "Примеры решений в роботизации склада"


def test_docx_table_with_mismatched_counts_is_skipped():
    content = make_docx([["IMG:r1", "IMG:r2"], ["AMR (на примере модели Ronavi H1500)"]], {"r1": png_bytes(), "r2": png_bytes()})
    photos, warnings = parse_examples_docx(content)
    assert photos == [] and "2 фото и 1 подписей" in warnings[0]


def test_not_a_docx_raises():
    with pytest.raises(ExamplesDocumentError, match="Word"):
        parse_examples_docx(b"not a zip")


@pytest.mark.skipif(not DOCX.exists(), reason="документ организатора не положен в datasets/")
def test_organizer_document_has_eight_photos():
    photos, warnings = parse_examples_docx(DOCX.read_bytes())
    assert warnings == []
    assert [p.model for p in photos] == [
        "Ronavi H1500", "DMR Carrier P", "MARK 2 SE", "Pallet shuttle от Stelcon",
        "Cognitive Pilot", "EVOCARGO N1", "Ronavi SD", "PuduBot 2",
    ]
    for photo in photos:
        image = emf_bitmap(photo.data) if photo.media.endswith(".emf") else decode_upload(photo.data)
        assert min(image.size) >= 200


def test_example_spec_lines_are_converted_to_reference_units():
    from app.services.example_specs_import import parse_spec_lines

    parsed, unknown = parse_spec_lines([
        "Грузоподъёмность: до 2 тонн.",
        "Масса робота: около 2000–2500 кг.",
        "Габариты (В×Ш×Г): примерно 2050 × 1975 × 1000 мм.",
        "Скорость движения: Рабочая — от 5 до 20–25 км/ч",
        "Время зарядки: около 18 минут на станции.",
        "Время работы: до 3 часов на одном заряде (в некоторых режимах до 4 часов со станцией).",
        "Производительность: до 80–100 паллет/час (при типовой конфигурации зоны).",
        "Эффективность уборки: до 1000 м2/ч.",
        "Ширина захвата (уборки): от 43 до 60 см.",
        "Ширина проезда: 80см",
        "Допустимые условия эксплуатации: работа 24/7 при температуре примерно −40…+50 °C.",
        "Мощность: Номинальная от 30 л.с. до максимальной 50 л.с.",
    ])
    values = {p.code: p for p, _ in parsed}
    assert values["payload_kg"].value == 2000
    assert values["weight_kg"].value == 2500  # для числа из диапазона — верхняя граница
    assert (values["length_mm"].value, values["width_mm"].value, values["height_mm"].value) == (1000, 1975, 2050)
    assert values["max_speed_mps"].value == 6.9444
    assert values["charge_time_h"].value == 0.3
    assert (values["runtime_h"].value, values["runtime_h"].value_max) == (3, 4)
    assert (values["throughput"].value, values["throughput"].value_max, values["throughput"].unit) == (80, 100, "паллет/ч")
    assert values["cleaning_width_mm"].value == 430 and values["cleaning_width_mm"].value_max == 600
    assert values["min_aisle_width_mm"].value == 800
    assert (values["operating_temp_c"].value, values["operating_temp_c"].value_max) == (-40, 50)
    assert values["operating_conditions"].text.startswith("работа 24/7")
    # Вторая «производительность» (эффективность уборки) не перезаписывает первую, мощности нет в справочнике.
    assert unknown == ["Мощность: Номинальная от 30 л.с. до максимальной 50 л.с."]


def test_combined_charge_and_runtime_and_default_dimension_order():
    from app.services.example_specs_import import parse_spec_lines

    parsed, unknown = parse_spec_lines(["Габариты: 580*535*1290мм", "Время зарядки/работы: 4 часа/12 часов", "Вес: 39кг"])
    values = {p.code: p.value for p, _ in parsed}
    assert unknown == []
    assert values == {"length_mm": 580, "width_mm": 535, "height_mm": 1290, "charge_time_h": 4, "runtime_h": 12, "weight_kg": 39}


@pytest.mark.skipif(not DOCX.exists(), reason="документ организатора не положен в datasets/")
def test_organizer_document_specs_are_recognized():
    from app.services.example_specs_import import parse_spec_lines

    solutions, _ = parse_examples_docx(DOCX.read_bytes())
    by_model = {s.model: parse_spec_lines(s.lines) for s in solutions}
    h1500 = {p.code: p for p, _ in by_model["Ronavi H1500"][0]}
    assert h1500["payload_kg"].value == 1500 and h1500["positioning_accuracy_mm"].value == 3
    assert (h1500["operating_temp_c"].value, h1500["operating_temp_c"].value_max) == (5, 25)
    assert all(len(parsed) >= 5 for parsed, _ in by_model.values())


def test_category_only_product_gets_type_from_document_caption():
    from app.models import Product, SolutionType
    from app.services.example_specs_import import refine_type
    from app.services.solution_examples import ExampleSolution

    category = SolutionType(id=1, code="mobile_robots", name="Мобильные роботы", parent_id=None)
    fmr = SolutionType(id=2, code="fmr", name="FMR", parent_id=5)
    amr = SolutionType(id=3, code="amr", name="AMR", parent_id=1)
    types = {"mobile_robots": category, "fmr": fmr, "amr": amr}
    caption = ExampleSolution(model="DMR Carrier P", kind="FMR (мобильный вилочный робот)", section=None, media=None, data=b"")
    assert refine_type(Product(solution_type=category), caption, types) is fmr
    # У товара уже есть точный тип — документ его не меняет.
    assert refine_type(Product(solution_type=amr), caption, types) is None
    unknown = ExampleSolution(model="X", kind="Шаттл система", section=None, media=None, data=b"")
    assert refine_type(Product(solution_type=category), unknown, types) is None
