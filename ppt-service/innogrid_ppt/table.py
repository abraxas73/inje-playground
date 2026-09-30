# -*- coding: utf-8 -*-
"""표 엔진.

템플릿의 표(85~92)는 서식이 전부 동일하고 크기만 다르다.
그래서 복제하지 않고 파라미터로 새로 그린다 — 그러면 템플릿에 없는
행 수(7행 같은)도 자연히 처리된다.

템플릿 노트 85~87 (모든 표형식에 적용):
  · "각 열의 너비는 글자수에 따라 달라집니다. 가장 긴 줄을 기준으로 각 열의 너비를 산정
     (긴 글 > 너비 넓게 / 짧은 글 > 너비 좁게)"          → _auto_col_widths()
  · "한 줄로 부족하면 줄갈이를 해주시고, 줄갈이 시 해당 행의 높이값은 여백을 유지하며 커집니다"
                                                            → _auto_row_heights()

서식은 전부 v1.0 실측값 (v1.4와 달라진 곳은 ★):
  헤더 행    ★#0150FF 배경 (v1.4 0066FF), SemiBold 8pt 흰색, 위·바깥 선 없음, 아래 선 있음
  구분열     #E5F0FF 배경, SemiBold 8pt 검정
  본문       #FFFFFF 배경, Regular 8pt 검정
  내부 가로선 ★#C9DFFF 0.75pt 실선 (v1.4 C5DEFF 0.5pt) — 인접 셀 양쪽(lnB·lnT)에 모두 넣는다.
              한쪽만 넣으면 PowerPoint가 이웃 셀의 noFill을 우선해 선이 사라진다 (템플릿도 양쪽에 넣는다)
  내부 세로선 ★#C9DFFF 0.75pt 실선 (v1.4는 점선 sysDot)
  바깥 테두리 좌·우·위 없음, ★마지막 행 아래 선 있음
  셀 여백    좌우 0.4cm / 상하 0 / 세로 가운데
  서술형 셀  글머리 • marL 0.30cm / 단락 뒤 5pt (24번 실측) — bullets=True 일 때만
"""

from lxml import etree
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

from . import tokens as T
from .oxml import clear_table_style, set_cell_borders, set_run_font, sub


def _units(text):
    """셀 글의 가장 긴 줄 폭 (한글 1자 = 1em 기준)."""
    from .slots import text_units
    return max((text_units(ln) for ln in str(text).split("\n")), default=0.0)


def _col_widths(total_w, ncols, divider_cols, divider_w, explicit, grid=None, size=8.0):
    if explicit:
        if len(explicit) != ncols:
            raise ValueError(f"col_widths 개수 {len(explicit)} ≠ 열 수 {ncols}")
        if abs(sum(explicit) - total_w) > 0.02:
            raise ValueError(f"열 폭 합계 {sum(explicit):.2f} ≠ 표 폭 {total_w:.2f}")
        return list(explicit)
    if grid is None:
        rest = total_w - divider_w * divider_cols
        if rest <= 0 or ncols <= divider_cols:
            raise ValueError("구분열이 표 폭을 다 먹는다")
        return [divider_w] * divider_cols + [rest / (ncols - divider_cols)] * (ncols - divider_cols)
    return _auto_col_widths(total_w, ncols, divider_cols, divider_w, grid, size)


def _auto_col_widths(total_w, ncols, divider_cols, divider_w, grid, size):
    """열 폭을 **가장 긴 글** 기준으로 배분한다 (노트 85~87).

    각 열의 '가장 긴 줄' 글자 폭 + 셀 여백을 그 열의 요구 폭으로 보고, 표 폭에 비례 배분한다.
    구분열은 기본 폭(2.80) 밑으로, 다른 열은 최소 폭(2.00) 밑으로 내려가지 않는다.
    긴 글이 한 열에 몰리면 그 열이 넓어지고 나머지가 좁아진다 — 노트가 요구하는 그대로다.
    """
    em = size / 72 * 2.54
    need = []
    for ci in range(ncols):
        longest = max(_units(row[ci]) for row in grid)
        need.append(longest * em + 2 * T.TABLE_CELL_MARGIN)
    mins = [T.TABLE_DIVIDER_W if ci < divider_cols else T.TABLE_COL_MIN_W for ci in range(ncols)]
    if sum(mins) > total_w + 0.02:
        raise ValueError(f"열이 {ncols}개라 최소 폭 합계가 표 폭을 넘는다")
    widths = [max(n, m) for n, m in zip(need, mins)]
    extra = total_w - sum(widths)
    if extra >= 0:
        # 남는 폭은 **본문 열에 똑같이** 나눠 준다 — 구분열은 글자수만큼만 갖는다.
        # (짧은 글만 있는 표에서 구분열이 절반을 먹는 일이 없도록)
        share = [i for i in range(ncols) if i >= divider_cols] or list(range(ncols))
        for i in share:
            widths[i] += extra / len(share)
        return widths
    # 넘치면 요구 폭 비례로 줄이되, 최소 폭 밑으로 내려간 열은 최소 폭으로 되돌리고 넓은 열에서 뺀다
    scale = total_w / sum(widths)
    widths = [w * scale for w in widths]
    for _ in range(ncols):
        short = [i for i in range(ncols) if widths[i] < mins[i] - 1e-6]
        if not short:
            break
        deficit = sum(mins[i] - widths[i] for i in short)
        for i in short:
            widths[i] = mins[i]
        wide = [i for i in range(ncols) if i not in short]
        pool = sum(widths[i] - mins[i] for i in wide)
        for i in wide:
            widths[i] -= deficit * ((widths[i] - mins[i]) / pool if pool else 0)
    return widths


def _lines_in(text, col_w, size):
    """이 폭의 셀에서 글이 몇 줄로 접히는가."""
    from .slots import text_units
    em = size / 72 * 2.54
    cpl = max(1, int((col_w - 2 * T.TABLE_CELL_MARGIN) / em))
    n = 0
    for ln in str(text).split("\n"):
        u = text_units(ln)
        n += max(1, int(u / cpl) + (1 if u % cpl else 0))
    return n


def _auto_row_heights(grid, widths, size, header_h, bullets=False):
    """행 높이 = 위·아래 여백 + 줄 수 × 줄 높이 (노트: 줄갈이 시 여백을 유지하며 커진다)."""
    pitch = size / 72 * 2.54 * 1.3
    aft = (T.TABLE_BULLET_SPC_AFT / 72 * 2.54) if bullets else 0.0
    heights = []
    for ri, row in enumerate(grid):
        lines = max(_lines_in(cell, w, size) for cell, w in zip(row, widths))
        paras = max(len(str(cell).split("\n")) for cell in row)
        h = 2 * T.TABLE_ROW_PAD + lines * pitch + (paras - 1) * aft
        if ri == 0:
            h = max(header_h, h)
        else:
            h = max(T.TABLE_ROW_H, h)
        heights.append(h)
    return heights


def _write_cell(cell, text, *, font, size, color, fill, bullets=False):
    cell.fill.solid()
    cell.fill.fore_color.rgb = RGBColor.from_string(fill)
    cell.margin_left = T.cm(T.TABLE_CELL_MARGIN)
    cell.margin_right = T.cm(T.TABLE_CELL_MARGIN)
    cell.margin_top = 0
    cell.margin_bottom = 0
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE

    tf = cell.text_frame
    tf.word_wrap = True
    lines = str(text).split("\n")
    tf.text = lines[0]
    for extra in lines[1:]:
        tf.add_paragraph().text = extra
    for p in tf.paragraphs:
        p.alignment = PP_ALIGN.LEFT
        if bullets:
            _bulletize(p._p)
        for r in p.runs:
            r.font.size = Pt(size)
            r.font.color.rgb = RGBColor.from_string(color)
            # 굵기는 폰트 이름으로. b="1" 금지 — 가이드 §03
            set_run_font(r.font._rPr, font)


def _bulletize(p):
    """24번 서술형 셀의 문단 서식: marL 0.30 / indent -0.30 / • / 단락 뒤 5pt."""
    pPr = p.find(qn("a:pPr"))
    if pPr is None:
        pPr = etree.Element(qn("a:pPr"))
        p.insert(0, pPr)
    pPr.set("marL", str(T.TABLE_BULLET_MARL))
    pPr.set("indent", str(-T.TABLE_BULLET_MARL))
    for tag in ("a:spcAft", "a:buFont", "a:buChar", "a:buNone"):
        for e in pPr.findall(qn(tag)):
            pPr.remove(e)
    spc = etree.SubElement(pPr, qn("a:spcAft"))
    sub(spc, "a:spcPts", val=int(round(T.TABLE_BULLET_SPC_AFT * 100)))
    sub(pPr, "a:buFont", typeface="Arial", pitchFamily=34, charset=0)
    sub(pPr, "a:buChar", char="•")


def render_table(slide, header, rows, *, x, y, w, max_h=None, h=None,
                 divider_cols=1, divider_w=2.80, col_widths=None,
                 header_h=None, font_size=None, merge_divider=True, bullets=False,
                 template_path=None):
    """표 하나를 그린다. (그래픽프레임, 열 폭 리스트, 실제 높이) 를 돌려준다.

    header       : 헤더 행 문자열 리스트
    rows         : 본문 행. 각 행은 문자열 리스트. 셀 안 줄바꿈은 "\\n"
    divider_cols : 왼쪽 구분열 개수 (배경 #E5F0FF)
    merge_divider: 구분열에서 같은 값이 이어지면 병합
    bullets      : 본문 셀에 글머리 기호 (서술형 표)
    max_h        : 자리의 높이. 넘치는지는 부르는 쪽이 판정한다 (표 자체는 내용 높이로 그린다)
    """
    ncols = len(header)
    for i, r in enumerate(rows):
        if len(r) != ncols:
            raise ValueError(f"{i+1}번째 행의 칸 수 {len(r)} ≠ 헤더 {ncols}")

    nrows = len(rows) + 1
    header_h = header_h if header_h is not None else T.TABLE_HEADER_H
    size = font_size if font_size is not None else T.TABLE_FONT
    grid = [list(header)] + [list(r) for r in rows]
    widths = _col_widths(w, ncols, divider_cols, divider_w, col_widths, grid=grid, size=size)
    heights = _auto_row_heights(grid, widths, size, header_h, bullets=bullets)
    total_h = sum(heights)

    gf = slide.shapes.add_table(nrows, ncols, T.cm(x), T.cm(y), T.cm(w), T.cm(total_h))
    table = gf.table
    clear_table_style(table)

    for i, cw in enumerate(widths):
        table.columns[i].width = T.cm(cw)
    for i, rh in enumerate(heights):
        table.rows[i].height = T.cm(rh)

    # 병합을 **글자를 넣기 전에** 끝낸다.
    # python-pptx의 merge()는 합쳐지는 칸들의 글자를 이어붙이므로,
    # 나중에 병합하면 "비용 비용"처럼 값이 두 번 들어간다.
    if merge_divider:
        _merge_divider(table, nrows, divider_cols, grid)

    last = nrows - 1
    for ri in range(nrows):
        for ci in range(ncols):
            cell = table.cell(ri, ci)
            if cell.is_spanned:          # 병합에 먹힌 칸은 건드리지 않는다
                continue
            first_col, last_col = ci == 0, ci == ncols - 1
            if ri == 0:
                _write_cell(cell, grid[ri][ci], font=T.F_SEMIBOLD, size=size,
                            color=T.WHITE, fill=T.ACCENT_TABLE)
                set_cell_borders(
                    cell,
                    left=None if first_col else "solid",
                    right=None if last_col else "solid",
                    top=None,                       # 표 위 바깥선 없음
                    bottom="solid",                 # 헤더 아래 선 (23·25 실측)
                )
            else:
                is_div = ci < divider_cols
                _write_cell(
                    cell, grid[ri][ci],
                    font=T.F_SEMIBOLD if is_div else T.F_REGULAR,
                    size=size, color=T.TEXT,
                    fill=T.BLUE_075 if is_div else T.CARD,
                    bullets=bullets and not is_div,
                )
                set_cell_borders(
                    cell,
                    left=None if first_col else "solid",     # 좌·우 바깥선 없음
                    right=None if last_col else "solid",
                    top="solid",
                    bottom="solid",   # 위·아래 둘 다. 한쪽만 주면 PowerPoint가 이웃 셀의 noFill을 우선해 선이 사라진다
                )

    return gf, widths, total_h


def _merge_divider(table, nrows, divider_cols, grid):
    for ci in range(divider_cols):
        start = 1
        for ri in range(2, nrows + 1):
            same = ri < nrows and grid[ri][ci] == grid[start][ci] and grid[start][ci] != ""
            if same:
                continue
            if ri - 1 > start:
                table.cell(start, ci).merge(table.cell(ri - 1, ci))
            start = ri
