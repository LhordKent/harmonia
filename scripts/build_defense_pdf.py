"""Build the plain-language defense guide. Requires reportlab and pypdf."""
from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/harmonia-defense-cheatsheet.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
font_root = Path('C:/Windows/Fonts')
if (font_root / 'arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Guide', str(font_root / 'arial.ttf')))
    pdfmetrics.registerFont(TTFont('GuideBold', str(font_root / 'arialbd.ttf')))
    pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='GuideBold', italic='Guide', boldItalic='GuideBold')
    regular, bold = 'Guide', 'GuideBold'
else:
    regular, bold = 'Helvetica', 'Helvetica-Bold'
navy = colors.HexColor('#15253B')
purple = colors.HexColor('#6346BC')
muted = colors.HexColor('#526477')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='GuideTitle', fontName=bold, fontSize=24, leading=29, textColor=navy, spaceAfter=18))
styles.add(ParagraphStyle(name='GuideHeading', fontName=bold, fontSize=12, leading=16, textColor=purple, spaceBefore=12, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle(name='GuideBody', fontName=regular, fontSize=10.3, leading=15.3, textColor=navy, spaceAfter=9))
styles.add(ParagraphStyle(name='GuideBullet', parent=styles['GuideBody'], leftIndent=11, firstLineIndent=-8, spaceAfter=6))
styles.add(ParagraphStyle(name='GuideCell', fontName=regular, fontSize=9.2, leading=12.7, textColor=navy))
styles.add(ParagraphStyle(name='GuideTH', parent=styles['GuideCell'], fontName=bold, textColor=colors.white))

def rich(text):
    text = escape(text)
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.states = []
    def showPage(self):
        self.states.append(dict(self.__dict__))
        self._startPage()
    def save(self):
        total = len(self.states)
        for state in self.states:
            self.__dict__.update(state)
            self.setFillColor(purple)
            self.rect(0, A4[1]-9, A4[0], 9, fill=1, stroke=0)
            self.setFont(bold, 8)
            self.setFillColor(muted)
            self.drawString(46, A4[1]-34, 'HARMONIA  /  DEFENSE FIELD GUIDE')
            self.setStrokeColor(colors.HexColor('#DDE3ED'))
            self.line(46, 40, A4[0]-46, 40)
            self.setFont(regular, 8)
            self.drawString(46, 26, 'Implementation snapshot | 11 Nov 2026 | Evidence-aware presenter copy')
            self.drawRightString(A4[0]-46, 26, f'{self._pageNumber} / {total}')
            super().showPage()
        super().save()

source = (ROOT / 'docs/defense-cheatsheet.md').read_text(encoding='utf-8')
chapters = source.split('---PAGE---')
story = []
for chapter_index, chapter in enumerate(chapters):
    if chapter_index:
        story.append(PageBreak())
    lines = chapter.strip().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+', c) for c in cells): rows.append(cells)
                i+=1
            n=len(rows[0]); width=A4[0]-92
            widths = [width*.25, width*.75] if n==2 else [width*.22, width*.36, width*.42]
            data=[[Paragraph(rich(c),styles['GuideTH' if r==0 else 'GuideCell']) for c in row] for r,row in enumerate(rows)]
            table=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),navy),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F1F3F9'),colors.white]),
                ('LINEBELOW',(0,0),(-1,-1),.35,colors.HexColor('#DCE2EC'))]))
            story.extend([table,Spacer(1,10)])
            continue
        if line.startswith('# '):
            story.append(Paragraph(rich(line[2:]),styles['GuideTitle']))
        elif line.startswith('## '):
            story.append(Paragraph(rich(line[3:]),styles['GuideHeading']))
        elif line.startswith('- '):
            story.append(Paragraph('• '+rich(line[2:]),styles['GuideBullet']))
        else:
            story.append(Paragraph(rich(line),styles['GuideBody']))
        i+=1
doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=46,leftMargin=46,topMargin=57,bottomMargin=55,
    title='Harmonia - Plain-language Defense Cheatsheet',author='Harmonia implementation documentation',
    subject='Current system, grading, coach review, demo, questions and evidence limits')
doc.build(story,canvasmaker=NumberedCanvas)
reader=PdfReader(OUT)
assert len(reader.pages)==len(chapters), f'Unexpected overflow: {len(reader.pages)} pages for {len(chapters)} chapters'
for index,page in enumerate(reader.pages):
    assert len(page.extract_text() or '')>250, f'Unexpected empty page {index+1}'
print(f'Created {OUT} ({len(reader.pages)} pages, {OUT.stat().st_size:,} bytes)')
