import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    KeepTogether
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "site", "assets", "fonts")
OUT = os.path.join(ROOT, "artifacts", "AEOGEO-vs-Otterly-Peec-Semrush-buyers-brief.pdf")
PREVIEW = os.path.join(ROOT, "artifacts", "aeogeo-buyers-brief-preview.png")

pdfmetrics.registerFont(TTFont("Inter", os.path.join(FONT, "inter-400.ttf")))
pdfmetrics.registerFont(TTFont("Inter-M", os.path.join(FONT, "inter-500.ttf")))
pdfmetrics.registerFont(TTFont("Inter-SB", os.path.join(FONT, "inter-600.ttf")))
pdfmetrics.registerFont(TTFont("Inter-B", os.path.join(FONT, "inter-700.ttf")))
pdfmetrics.registerFont(TTFont("Sora", os.path.join(FONT, "sora-600.ttf")))
pdfmetrics.registerFont(TTFont("Sora-B", os.path.join(FONT, "sora-700.ttf")))
pdfmetrics.registerFont(TTFont("Sora-BB", os.path.join(FONT, "sora-800.ttf")))

NAVY = HexColor("#0C1730")
NAVY2 = HexColor("#152446")
ROYAL = HexColor("#4F7DF9")
ROYAL_D = HexColor("#234CA9")
INK = HexColor("#172033")
MUTED = HexColor("#65728A")
MUTED2 = HexColor("#77839A")
LINE = HexColor("#DCE4F1")
SOFT = HexColor("#F4F7FF")
SOFT_LINE = HexColor("#CBD9F8")
GREEN = HexColor("#176B45")
GREEN_BG = HexColor("#E8F7EF")
BLUE_BG = HexColor("#EDF3FF")
WHITE = white

PAGE_W, PAGE_H = LETTER
LM = RM = 30
CONTENT_W = PAGE_W - LM - RM

# Paragraph styles.
base = dict(alignment=TA_LEFT)
s_dek = ParagraphStyle("dek", **base, fontName="Inter", fontSize=8.2, leading=10.1, textColor=HexColor("#DCE7FF"))
s_short = ParagraphStyle("short", **base, fontSize=7.7, leading=9.2, textColor=HexColor("#354156"))
s_vendor = ParagraphStyle("vendor", **base, fontName="Sora-B", fontSize=8.0, leading=9.3, textColor=NAVY)
s_vtype = ParagraphStyle("vtype", **base, fontName="Inter-SB", fontSize=5.9, leading=6.8, textColor=MUTED2)
s_label = ParagraphStyle("label", **base, fontName="Inter-B", fontSize=6.2, leading=7.3, textColor=MUTED)
s_label_note = ParagraphStyle("labelnote", **base, fontSize=5.9, leading=6.7, textColor=HexColor("#8A95A8"))
s_cell = ParagraphStyle("cell", **base, fontSize=7.35, leading=8.75, textColor=HexColor("#354156"))
s_cell_small = ParagraphStyle("cells", **base, fontSize=6.6, leading=7.85, textColor=HexColor("#5D697E"))
s_price = ParagraphStyle("price", **base, fontName="Sora-B", fontSize=12.2, leading=13.3, textColor=NAVY)
s_price_note = ParagraphStyle("pricenote", **base, fontSize=6.35, leading=7.55, textColor=HexColor("#68758B"))
s_badge = ParagraphStyle("badge", **base, fontName="Sora-B", fontSize=6.0, leading=7.0)
s_cov = ParagraphStyle("cov", **base, fontSize=6.6, leading=7.9, textColor=HexColor("#5D697E"))
s_h3 = ParagraphStyle("h3", **base, fontName="Sora-B", fontSize=9.3, leading=10.6, textColor=NAVY)
s_pick_label = ParagraphStyle("picklabel", **base, fontName="Inter-B", fontSize=6.0, leading=7.0, textColor=ROYAL)
s_pick = ParagraphStyle("pick", **base, fontSize=6.95, leading=8.2, textColor=HexColor("#354156"))
s_question = ParagraphStyle("question", **base, fontSize=6.95, leading=8.3, textColor=HexColor("#354156"))
s_bottom = ParagraphStyle("bottom", **base, fontSize=5.95, leading=7.25, textColor=HexColor("#55627A"))
s_source = ParagraphStyle("source", **base, fontSize=5.55, leading=6.7, textColor=HexColor("#7B879B"))
s_footer = ParagraphStyle("footer", **base, fontSize=5.85, leading=6.8, textColor=HexColor("#7B879B"))


def draw_star(c, x, y, s=12):
    c.saveState()
    c.translate(x, y)
    c.setStrokeColor(HexColor("#8FB0FF"))
    c.setLineWidth(1.8)
    c.setLineCap(1)
    c.setLineJoin(1)
    p = c.beginPath()
    p.moveTo(0, s)
    p.lineTo(s * 0.20, s * 0.20)
    p.lineTo(s, 0)
    p.lineTo(s * 0.20, -s * 0.20)
    p.lineTo(0, -s)
    p.lineTo(-s * 0.20, -s * 0.20)
    p.lineTo(-s, 0)
    p.lineTo(-s * 0.20, s * 0.20)
    p.close()
    c.drawPath(p, stroke=1, fill=0)
    c.restoreState()


def page_background(c, doc):
    c.saveState()
    # Header band.
    c.setFillColor(NAVY)
    c.rect(0, 644, PAGE_W, PAGE_H - 644, stroke=0, fill=1)

    # Brand mark and wordmark.
    c.setFillColor(NAVY2)
    c.roundRect(LM, 754, 23, 23, 5, stroke=0, fill=1)
    draw_star(c, LM + 11.5, 765.5, 6.3)
    c.setFont("Sora-BB", 13.2)
    c.setFillColor(WHITE)
    x = LM + 30
    c.drawString(x, 764, "AEO")
    x += c.stringWidth("AEO", "Sora-BB", 13.2)
    c.setFillColor(HexColor("#8FB0FF"))
    c.drawString(x, 764, "GEO")
    x += c.stringWidth("GEO", "Sora-BB", 13.2)
    c.setFillColor(WHITE)
    c.drawString(x, 764, " Search")
    c.setFont("Inter-SB", 6.0)
    c.setFillColor(HexColor("#9FB9FF"))
    c.drawString(LM + 30, 752.5, "AI SEARCH BUYER'S BRIEF")

    # Header meta.
    c.setFont("Inter-SB", 5.9)
    c.setFillColor(HexColor("#DCE7FF"))
    c.drawRightString(PAGE_W - RM, 768, "PREPARED FOR A SMALL-BUSINESS OWNER")
    c.setFillColor(HexColor("#B9C7E4"))
    c.drawRightString(PAGE_W - RM, 757, "PRICES VERIFIED NOVEMBER 17, 2026")
    c.drawRightString(PAGE_W - RM, 746, "USD, EXCLUDING TAX")

    # Kicker and title.
    c.setFillColor(HexColor("#8FB0FF"))
    c.setFont("Sora-B", 6.7)
    c.drawString(LM, 727, "THE PRACTICAL COMPARISON")
    c.setFillColor(WHITE)
    c.setFont("Sora-B", 21.2)
    c.drawString(LM, 706, "AEOGEO vs.")
    c.drawString(LM, 683, "Otterly, Peec & Semrush")

    # Price flag.
    c.setFillColor(NAVY2)
    c.setStrokeColor(HexColor("#2B3D60"))
    c.setLineWidth(0.7)
    c.roundRect(462, 661, 120, 50, 5, stroke=1, fill=1)
    c.setFillColor(HexColor("#9FB9FF"))
    c.setFont("Sora-B", 5.8)
    c.drawString(471, 698, "ENTRY PRICE RANGE")
    c.setFillColor(WHITE)
    c.setFont("Sora-BB", 14.0)
    c.drawString(471, 682, "$29–$349")
    c.setFillColor(HexColor("#B9C7E4"))
    c.setFont("Inter", 6.0)
    c.drawString(471, 671, "per month")
    c.setFont("Inter", 5.45)
    c.drawString(471, 663, "published entry plans")

    # Short version callout.
    c.setFillColor(SOFT)
    c.setStrokeColor(SOFT_LINE)
    c.setLineWidth(0.6)
    c.roundRect(LM, 564, CONTENT_W, 70, 6, stroke=1, fill=1)
    c.setFillColor(ROYAL)
    c.setFont("Sora-B", 6.2)
    c.drawString(LM + 10, 618, "BEST VALUE FOR A SMALL BUSINESS")
    s = Paragraph(
        "<b>Best value: Otterly Lite at $29/mo.</b> It is the cheapest verified plan here that tracks "
        "Perplexity daily, and 12 months costs $348 versus $4,188 for AEOGEO Starter. Otterly shows you "
        "the data; AEOGEO does the implementation. Buy a tool only if someone will act on it.",
        s_short,
    )
    w, h = s.wrap(CONTENT_W - 20, 48)
    s.drawOn(c, LM + 10, 606 - h)

    # Section heading.
    c.setFillColor(NAVY)
    c.setFont("Sora-B", 10.3)
    c.drawString(LM, 548, "WHAT YOU GET AT THE ENTRY PRICE")
    c.setFillColor(MUTED2)
    c.setFont("Inter", 5.9)
    c.drawRightString(PAGE_W - RM, 548, "Published list prices  •  Perplexity coverage checked separately")

    # Footer.
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(LM, 34, PAGE_W - RM, 34)
    c.setFillColor(MUTED2)
    c.setFont("Inter", 5.7)
    c.drawString(LM, 21, "AEOGEO Search  •  McKinney, TX  •  aeogeosearch.com  •  (469) 905-2836")
    c.drawRightString(PAGE_W - RM, 21, "One-page buyer's brief  •  November 17, 2026")
    c.restoreState()


def p(text, style):
    return Paragraph(text, style)


def label(main, note=""):
    text = f"<b>{main}</b>"
    if note:
        text += f"<br/><font name='Inter' size='5.85' color='#8A95A8'>{note}</font>"
    return p(text, s_label)


def badge(text, color):
    return p(f"<font name='Sora-B' size='5.95' color='{color}'>●  {text}</font>", s_badge)


def coverage(text, badge_text, badge_color):
    return [badge(badge_text, badge_color), p(text, s_cov)]


def money(amount, unit, note):
    return p(
        f"<font name='Sora-B' size='12.2' color='#0C1730'>{amount}</font>"
        f"<font name='Inter' size='6.45' color='#68758B'>{unit}</font><br/>"
        f"<font name='Inter' size='6.25' color='#68758B'>{note}</font>",
        s_price,
    )


def bullets(items):
    return p("<br/>".join(f"<font color='#4F7DF9'>•</font>  {x}" for x in items), s_cell_small)


table_data = [
    [
        p("", s_label),
        [p("AEOGEO Search", s_vendor), p("DONE-FOR-YOU SERVICE", s_vtype)],
        [p("Otterly", s_vendor), p("SELF-SERVE SOFTWARE", s_vtype)],
        [p("Peec", s_vendor), p("SELF-SERVE SOFTWARE", s_vtype)],
        [p("Semrush", s_vendor), p("SEO + AI VISIBILITY SUITE", s_vtype)],
    ],
    [
        label("Entry plan", "published price"),
        money("$349", "/mo", "AI Visibility Starter<br/>No long-term contract on monthly plans"),
        money("$29", "/mo", "Lite; 15% off with annual billing"),
        money("$95", "/mo", "Starter; 15% off with annual billing"),
        money("$99", "/mo per domain", "AI Visibility Base, billed annually"),
    ],
    [
        label("12-month cost", "before discounts"),
        p("<font name='Sora-B' size='9.6' color='#0C1730'>$4,188</font><br/><font name='Inter' size='6.2' color='#68758B'>12 x $349; no annual commitment</font>", s_cell),
        p("<font name='Sora-B' size='9.6' color='#0C1730'>$348</font><br/><font name='Inter' size='6.2' color='#68758B'>12 x $29; annual saves 15%</font>", s_cell),
        p("<font name='Sora-B' size='9.6' color='#0C1730'>$1,140</font><br/><font name='Inter' size='6.2' color='#68758B'>12 x $95; annual saves 15%</font>", s_cell),
        p("<font name='Sora-B' size='9.6' color='#0C1730'>$1,188</font><br/><font name='Inter' size='6.2' color='#68758B'>annual billing; 12 x $99</font>", s_cell),
    ],
    [
        label("Perplexity", "vendor-published coverage"),
        coverage(
            "<b>Optimization scope, not a self-serve tracking dashboard.</b> AEOGEO's Learn and service pages "
            "name Perplexity as an AI answer engine; reporting is human-led.",
            "IN SCOPE", "#244FA7",
        ),
        coverage(
            "<b>Included on every plan.</b> Select Perplexity in your engine mix; daily checks. "
            "Lite includes 16 prompts on 4 engines.",
            "TRACKED", "#176B45",
        ),
        coverage(
            "<b>Included on every plan.</b> Choose Perplexity as one of your 3 models; daily checks. "
            "Starter includes 50 prompts.",
            "TRACKED", "#176B45",
        ),
        coverage(
            "<b>Perplexity mentions are included.</b> The pricing page names ChatGPT, Google AI, Gemini "
            "and Perplexity; report depth varies by feature.",
            "TRACKED", "#176B45",
        ),
    ],
    [
        label("What is included", "entry tier"),
        bullets([
            "Review selected prompts and brand mentions",
            "Optimize up to 2 existing pages per month",
            "4 social posts and a monthly progress summary",
        ]),
        bullets([
            "2,000 credits/month and 1 workspace",
            "Visibility, sentiment, citations and share of voice",
            "3 recommendations per week",
        ]),
        bullets([
            "50 prompts, 3 models, 1 project",
            "Unlimited users; visibility, sentiment and source analytics",
            "Recommended actions and shareable dashboards",
        ]),
        bullets([
            "1 domain for Brand Performance",
            "300 AI visibility reports per day",
            "AI competitor research, prompt research and AI-ready site audit",
        ]),
    ],
    [
        label("Who does the work", "time and skills needed"),
        p("AEOGEO does the optimization, content and reporting. You review and approve.", s_cell),
        p("You run prompts, read the dashboard and make the changes yourself.", s_cell),
        p("You or your marketing team turn the data into content and site changes.", s_cell),
        p("You use the data inside your existing SEO workflow; the toolkit does not implement fixes.", s_cell),
    ],
    [
        label("Best fit", "small-business use case"),
        p("You want a practical starting point and do not have marketing staff to execute.", s_cell),
        p("You want the lowest-cost way to watch Perplexity and other engines yourself.", s_cell),
        p("You want deeper prompt coverage and reporting than Otterly Lite, with a modest budget.", s_cell),
        p("You already pay for Semrush or need SEO and AI visibility in one place.", s_cell),
    ],
    [
        label("The catch", "what to watch"),
        p("Highest monthly cost. It is a limited service scope, not unlimited work.", s_cell),
        p("Monitoring only. Prompt credits and the 4-engine Lite limit constrain how much you can watch.", s_cell),
        p("Monitoring only. The entry plan tracks 3 models; extra models cost extra.", s_cell),
        p("Annual billing. AI visibility is one part of a larger suite, so you may pay for tools you do not use.", s_cell),
    ],
]

comparison = Table(
    table_data,
    colWidths=[76, 119, 119, 119, 119],
    repeatRows=0,
    hAlign="LEFT",
)
comparison.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (0, -1), 0),
    ("LEFTPADDING", (1, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4.2),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2),
    ("TOPPADDING", (0, 0), (-1, 0), 0),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 5.2),
    ("LINEBELOW", (0, 0), (-1, 0), 0.7, HexColor("#CBD6E8")),
    ("LINEBELOW", (0, 1), (-1, -2), 0.42, HexColor("#E6EBF4")),
    ("BACKGROUND", (0, 3), (-1, 3), HexColor("#FAFBFF")),
    ("LINEBELOW", (0, -1), (-1, -1), 0, WHITE),
]))

# Bottom panels.
picks = [
    ("I WANT IT DONE", "<b>AEOGEO Starter, $349/mo.</b> Best if you want pages, content and reporting handled. Growth is $649/mo and Authority is $999/mo if you need more output."),
    ("I WANT TO WATCH", "<b>Otterly Lite, $29/mo.</b> The cheapest entry here for daily Perplexity tracking. Useful if you will actually review the data and update your own site."),
    ("I WANT DEPTH", "<b>Peec Starter, $95/mo, or Semrush Base, $99/mo billed annually.</b> Peec for prompt and source analytics; Semrush if you also need a broader SEO toolkit."),
]
pick_table = Table(
    [[p(a, s_pick_label), p(b, s_pick)] for a, b in picks],
    colWidths=[55, 270],
    hAlign="LEFT",
)
pick_table.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("TOPPADDING", (0, 0), (-1, -1), 3.8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3.8),
    ("LINEABOVE", (0, 1), (-1, -1), 0.4, HexColor("#EDF1F7")),
    ("TOPPADDING", (0, 0), (-1, 0), 0),
    ("BOTTOMPADDING", (0, -1), (-1, -1), 0),
]))
left_panel = Table(
    [[[p("Choose by the job, not the logo", s_h3), Spacer(1, 4), pick_table]]],
    colWidths=[337],
    hAlign="LEFT",
)
left_panel.setStyle(TableStyle([
    ("BOX", (0, 0), (-1, -1), 0.55, HexColor("#DFE6F2")),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))

questions = [
    "Which exact prompts and engines are included, and how often does Perplexity run?",
    "Can I see the cited sources, not just a visibility score?",
    "Who implements the fixes, and how many pages or hours are included?",
    "Is this monthly or annual, and what changes at renewal?",
]
question_flow = [p("Ask before you pay", s_h3), Spacer(1, 5)]
for q in questions:
    question_flow.append(p(f"<font name='Inter-B' color='#315CB8'>?</font>  {q}", s_question))
right_panel = Table(
    [[question_flow]],
    colWidths=[203],
    hAlign="LEFT",
)
right_panel.setStyle(TableStyle([
    ("BOX", (0, 0), (-1, -1), 0.55, HexColor("#DFE6F2")),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
panels = Table(
    [[left_panel, right_panel]],
    colWidths=[337, 203],
    hAlign="LEFT",
)
panels.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))

bottom_text = p(
    "<b>Bottom line:</b> The tools cost $29–$99/month; AEOGEO starts at $349/month. That gap buys "
    "execution. If no one will act on the data, the cheaper tool is not actually cheaper; if you have an "
    "SEO team, monitoring may be all you need. AEOGEO authored this brief and is one of the options compared.",
    s_bottom,
)
sources_text = p(
    "<b>Sources (checked Nov 17, 2026):</b> "
    "<link href='https://aeogeosearch.com/pricing' color='#4B68A0'>aeogeosearch.com/pricing</link>; "
    "<link href='https://aeogeosearch.com/learn' color='#4B68A0'>aeogeosearch.com/learn</link>; "
    "<link href='https://otterly.ai/pricing' color='#4B68A0'>otterly.ai/pricing</link> "
    "(USD list, Nov 10, 2026; may show EUR by region); "
    "<link href='https://peec.ai/pricing' color='#4B68A0'>peec.ai/pricing</link>; "
    "<link href='https://www.semrush.com/pricing/ai' color='#4B68A0'>semrush.com/pricing/ai</link>. "
    "Vendor-published coverage; confirm prices and inclusions before purchase.",
    s_source,
)
bottom = Table(
    [[bottom_text, sources_text]],
    colWidths=[330, 210],
    hAlign="LEFT",
)
bottom.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (0, 0), 0),
    ("RIGHTPADDING", (0, 0), (0, 0), 10),
    ("LEFTPADDING", (1, 0), (1, 0), 0),
    ("RIGHTPADDING", (1, 0), (1, 0), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("LINEABOVE", (0, 0), (-1, 0), 0.55, HexColor("#DFE6F2")),
    ("TOPPADDING", (0, 0), (-1, 0), 6),
]))

story = [
    comparison,
    Spacer(1, 8),
    KeepTogether([panels]),
    Spacer(1, 5),
    KeepTogether([bottom]),
]

doc = BaseDocTemplate(
    OUT,
    pagesize=LETTER,
    leftMargin=LM,
    rightMargin=RM,
    topMargin=0,
    bottomMargin=0,
    title="AEOGEO vs. Otterly, Peec & Semrush | AI Search Buyer's Brief",
    author="AEOGEO Search",
    subject="One-page buyer's brief for a small business owner",
)
frame = Frame(LM, 46, CONTENT_W, 492, id="main", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="brief", frames=[frame], onPage=page_background)])
doc.build(story)

print("pdf:", OUT)
print("pages:", doc.page)

# Render the PDF page to an image so the layout can be inspected.
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument(OUT)
page = pdf[0]
bitmap = page.render(scale=2.0)
bitmap.to_pil().save(PREVIEW)
print("preview:", PREVIEW)
print("preview size:", bitmap.width, bitmap.height)
print("page count:", len(pdf))
