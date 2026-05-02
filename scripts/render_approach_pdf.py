from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "APPROACH.md"
OUTPUT_DIRECTORY = ROOT / "deliverables"
OUTPUT_FILE = OUTPUT_DIRECTORY / "Alemeno-Approach.pdf"


def escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("`", "")
    )


def build_styles():
    sample = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=sample["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        spaceAfter=8,
    )
    heading_1 = ParagraphStyle(
        "Heading1Custom",
        parent=sample["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        spaceAfter=10,
        textColor="#1f2937",
    )
    heading_2 = ParagraphStyle(
        "Heading2Custom",
        parent=sample["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        spaceBefore=8,
        spaceAfter=6,
        textColor="#9a3412",
    )
    heading_3 = ParagraphStyle(
        "Heading3Custom",
        parent=sample["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        spaceBefore=5,
        spaceAfter=4,
    )
    bullet = ParagraphStyle(
        "BulletCustom",
        parent=body,
        leftIndent=12,
        bulletIndent=0,
        spaceAfter=4,
    )
    return body, heading_1, heading_2, heading_3, bullet


def build_story():
    body, heading_1, heading_2, heading_3, bullet = build_styles()
    story = []

    for raw_line in SOURCE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line:
            story.append(Spacer(1, 4))
            continue

        if line.startswith("# "):
            story.append(Paragraph(escape(line[2:]), heading_1))
            continue

        if line.startswith("## "):
            story.append(Paragraph(escape(line[3:]), heading_2))
            continue

        if line.startswith("### "):
            story.append(Paragraph(escape(line[4:]), heading_3))
            continue

        if line[:2] in {"- ", "* "}:
            story.append(Paragraph(escape(line[2:]), bullet, bulletText="•"))
            continue

        if len(line) > 2 and line[0].isdigit() and line[1] == ".":
            story.append(Paragraph(escape(line[3:]), bullet, bulletText=f"{line[0]}.")) 
            continue

        story.append(Paragraph(escape(line), body))

    return story


def main():
    OUTPUT_DIRECTORY.mkdir(exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Alemeno Marker Scanner Approach",
        author="OpenAI Codex",
    )
    document.build(build_story())
    print(OUTPUT_FILE)


if __name__ == "__main__":
    main()
