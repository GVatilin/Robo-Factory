"""Standalone, searchable PDF with embedded Cyrillic fonts and paginated tables."""
from datetime import datetime, UTC
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle, PageBreak

LABELS = {
    "horizon_years": "Горизонт, лет", "baseline_annual_labor": "ФОТ базового процесса, ₽/год",
    "baseline_annual_other": "Прочие расходы базы, ₽/год", "hours_per_day": "Работа, ч/сутки",
    "days_per_year": "Рабочих дней в году", "electricity_price": "Электроэнергия, ₽/кВт·ч",
    "quantity": "Количество роботов, шт.", "equipment_price": "Цена робота, ₽",
    "monthly_fee": "Аренда робота, ₽/мес", "software": "ПО, ₽", "infrastructure": "Инфраструктура, ₽",
    "integration": "Интеграция, ₽", "commissioning": "Пусконаладка, ₽", "training": "Обучение, ₽",
    "reserve_percent": "Резерв CAPEX, %", "annual_service_per_robot": "Сервис робота, ₽/год",
    "annual_licenses": "Лицензии, ₽/год", "annual_operators": "Операторы, ₽/год",
    "annual_connectivity": "Связь, ₽/год", "annual_consumables": "Расходники, ₽/год",
    "annual_repairs": "Ремонт, ₽/год", "annual_other": "Прочие расходы, ₽/год",
    "component_replacement_cost": "Замена компонентов парка, ₽", "component_replacement_interval": "Период замены, лет",
    "power_kw": "Мощность робота, кВт", "labor_saving_percent": "Сокращение ФОТ, %",
    "other_saving_percent": "Сокращение прочих затрат, %", "annual_additional_benefit": "Дополнительный эффект, ₽/год",
    "service_life_years": "Срок службы, лет", "fleet_unrounded": "Парк до округления, шт.",
}


@lru_cache
def fonts():
    root = Path("/usr/share/fonts/truetype/dejavu")
    pdfmetrics.registerFont(TTFont("Robo", str(root / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("RoboBold", str(root / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily("Robo", normal="Robo", bold="RoboBold", italic="Robo", boldItalic="RoboBold")


def number(value, suffix=""):
    if value is None:
        return "Не определено"
    if isinstance(value, bool):
        return "Да" if value else "Нет"
    if isinstance(value, (int, float)):
        digits = 4 if value and abs(value) < 0.01 else 2
        return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",") + suffix
    return str(value)


def payback(value):
    if value is None:
        return "Не определена"
    if value < 1:
        return ("Менее 1 дня" if value * 365 < 1 else number(value * 365, " дн.")) + " (простая)"
    return number(value, " лет")


def pdf_report(result: dict, analysis: dict | None = None, snapshot: dict | None = None,
               title="Экономика роботизации", recommendation: dict | None = None) -> bytes:
    fonts()
    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, rightMargin=38, leftMargin=38,
                            topMargin=48, bottomMargin=42, title=title, author="Robo-Factory")
    width = A4[0] - 76
    body = ParagraphStyle("Body", fontName="Robo", fontSize=9, leading=14, spaceAfter=8, textColor=colors.HexColor("#263d56"), splitLongWords=True)
    heading = ParagraphStyle("Heading", parent=body, fontName="RoboBold", fontSize=15, leading=21, spaceBefore=12, spaceAfter=12, keepWithNext=True)
    small = ParagraphStyle("Small", parent=body, fontSize=8, leading=12, spaceAfter=0)
    th = ParagraphStyle("TH", parent=small, fontName="RoboBold", textColor=colors.white)
    story = []

    def paragraph(value, style=body):
        text = str(value if value is not None else "Не указано")
        text = "".join(c for c in text if ord(c) >= 32 or c in "\n\t")
        return Paragraph(escape(text).replace("\n", "<br/>"), style)

    def text(value):
        story.append(paragraph(value))

    def table(headers, rows, proportions=None):
        col_widths = [width * p / sum(proportions) for p in proportions] if proportions else [width / len(headers)] * len(headers)
        rows = [[paragraph(x, th) for x in headers]] + [[paragraph(x, small) for x in row] for row in rows]
        block = LongTable(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT", splitInRow=1)
        block.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#244f84")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f6fb")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LINEBELOW", (0, 0), (-1, -1), .35, colors.HexColor("#dbe4ef")),
        ]))
        story.extend([block, Spacer(1, 12)])

    def section(title):
        story.append(paragraph(title, heading))

    section(title)
    text("Robo-Factory • Отчёт об экономике роботизации")
    text(f"Сформирован {datetime.now(UTC):%d.%m.%Y %H:%M} UTC. Модель: {result['model_version']}. Горизонт: {result['inputs']['horizon_years']} лет.")
    text("Сценарии — альтернативы одного процесса. Их эффект не суммируется. Расчёт зависит от полноты исходных данных и допущений; он не является гарантией экономии.")
    if result["inputs"].get("default_profile"):
        text("ИСПОЛЬЗОВАНЫ ПРИМЕРНЫЕ ДОПУЩЕНИЯ. Цены, производительность и долю сокращения расходов необходимо подтвердить для объекта.")
    section("1. Сравнение сценариев")
    rows = [["Без роботизации", "0", number(result["baseline_annual_opex"]), "0", number(result["baseline_tco"])]]
    rows += [[r["name"], number(r["capex"]), number(r["annual_opex"]), number(r["annual_effect"]), number(r["tco"])] for r in result["results"]]
    table(["Сценарий", "CAPEX, ₽", "OPEX, ₽/год", "Эффект, ₽/год", "TCO, ₽"], rows, [2, 1, 1, 1, 1])
    table(["Сценарий", "Чистый эффект, ₽", "Окупаемость", "ROI, %"],
          [[r["name"], number(r["net_effect"]), payback(r["simple_payback_years"]), number(r["roi_percent"])] for r in result["results"]], [2, 1, 1, 1])
    if recommendation:
        section("Объяснение GPT")
        text("Текст рекомендации из текущего интерфейса. Числовые результаты рассчитаны приложением.")
        text(recommendation.get("recommendation", ""))
        for key, label in [("alternatives", "Альтернативы"), ("risks", "Риски"), ("missing_data", "Недостающие данные")]:
            text(label)
            for item in recommendation.get(key, []):
                text("• " + item)
        text("Модель: " + recommendation.get("model", "не указана"))

    for index, r in enumerate(result["results"]):
        story.append(PageBreak())
        section(f"2.{index + 1}. {r['name']}")
        text(r.get("interpretation", ""))
        for risk in r.get("risks", []):
            text("• " + risk)
        table(["Показатель", "Значение"], [["Экономия ФОТ, ₽/год", number(r.get("annual_labor_saving"))], ["Изменение OPEX, ₽/год (минус — снижение)", number(r.get("annual_opex_change"))]])
        for key, label in [("capex_breakdown", "Разовые вложения — CAPEX"), ("opex_breakdown", "Годовые расходы — OPEX")]:
            section(label)
            table(["Статья", "Сумма, ₽"], [[k, number(v)] for k, v in r[key].items()], [2, 1])
        if r.get("equipment"):
            section("Вспомогательное оборудование")
            table(["Позиция", "Расчёт, шт.", "Принято, шт.", "Стоимость, ₽"], [[i["name"], number(i["calculated"]), number(i["quantity"]), number(i["cost"])] for i in r["equipment"]["items"]], [2, 1, 1, 1])
            for item in r["equipment"]["formulas"] + r["equipment"]["assumptions"]:
                text(item)
        section("Денежный поток")
        table(["Год", "OPEX, ₽", "Замены, ₽", "Поток, ₽", "Накоплено, ₽"], [[y["year"], *[number(y[k]) for k in ("opex", "replacement", "cashflow", "cumulative")]] for y in r["years"]], [.5, 1, 1, 1, 1])
        section("Исходные допущения сценария")
        table(["Параметр", "Значение"], [[LABELS.get(k, k), number(v)] for k, v in result["inputs"]["scenarios"][index].items() if k not in ("name", "mode", "equipment")], [2, 1])

    story.append(PageBreak())
    section("3. Формулы и общие допущения")
    for name, formula in result["formulas"].items():
        text(name + ": " + formula)
    for assumption in result["assumptions"]:
        text("• " + assumption)
    table(["Параметр базы", "Значение"], [[LABELS[k], number(v)] for k, v in result["inputs"].items() if k in LABELS], [2, 1])
    if analysis:
        section("4. Чувствительность результата")
        for item in analysis["assumptions"]:
            text(item)
        for factor in dict.fromkeys(row["factor"] for row in analysis["rows"]):
            rows = [row for row in analysis["rows"] if row["factor"] == factor]
            section(rows[0]["label"])
            table(["Сценарий", "Изменение, %", "TCO, ₽", "Чистый эффект, ₽", "ROI, %"],
                  [[r["name"], number(row["delta_percent"]), number(r["tco"]), number(r["net_effect"]), number(r["roi_percent"])] for row in rows for r in row["results"]], [2, .8, 1, 1, .8])
    section("5. Источники и ручные корректировки")
    text("Основание изменения: " + (result["inputs"].get("adjustment_reason") or "Не указано; используйте исходные значения и пометки ниже."))
    for path, source in result["inputs"].get("input_evidence", {}).items():
        label = LABELS.get(path.split(".")[-1], path)
        value = result["inputs"].get("automatic_values", {}).get(path)
        text(f"{label} [{path}]. Первоначальное значение: {number(value)}. {source}")
    if snapshot:
        section("6. Параметры проекта и подбора")
        for key, value in snapshot.get("parameters", {}).items():
            text(f"{key}: {number(value)}")
        selection = snapshot.get("selection", {})
        for candidate in selection.get("candidates", []):
            text(f"{candidate['name']}: парк {candidate.get('quantity')}; {candidate.get('unit', '')}")
            for item in candidate.get("missing", []) + candidate.get("risks", []):
                text("• " + item)

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Robo", 8)
        canvas.setFillColor(colors.HexColor("#637a93"))
        canvas.drawString(38, 23, "Robo-Factory • robo-factory.ru")
        canvas.drawRightString(A4[0] - 38, 23, f"Страница {document.page}")
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
