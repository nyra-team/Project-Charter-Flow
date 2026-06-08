#!/usr/bin/env python3
"""
Generate a consolidated Granules Project Charter + Note for Approval (NFA)
.docx from a JSON payload (the merged pmo_charters row).

Usage:
    python3 generate_charter_nfa.py --in charter.json --out charter.docx

Mirrors the 17-section MES Charter+NFA template:
  1. Project Information (sponsor / PMs / dates / category / entity / note no)
  2. Executive Summary
  3. Project Description
  4. Background — current state + business drivers
  5. Scope (In / Out)
  6. Benefits & KPIs
  7. Business Case & ROI / Annum
  8. Implementation Roadmap & Milestones
  9. Revised Project Investment Summary (one-time CAPEX/OPEX + FY-wise recurring)
 10. Earlier vs Revised NFA (previous_nfa_amount vs total / le_amount)
 11. Constraints
 12. Risks (from pmo_risks — passed in as `risks` array)
 13. Assumptions
 14. Potential Additional Budget Areas
 15. Project Governance (Steering Committee + Key Project Members)
 16. Attachments
 17. Approval & Sign-off (from charter.signatories — dynamic chain from the DOA matrix)

The sign-off block reflects the resolved DOA chain with per-row status / decided-at.
"""
import argparse
import json
import sys
from datetime import datetime

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BRAND = RGBColor(0x0E, 0x7C, 0x86)   # Granules teal
INK = RGBColor(0x0F, 0x17, 0x2A)
MUTED = RGBColor(0x47, 0x55, 0x69)
HDR_BG = "0E7C86"
SUBHDR_BG = "CCE7E9"
BAND_BG = "F1F5F9"
ACCENT_BG = "DBF2F4"


# ───── helpers ──────────────────────────────────────────────────────────────
def set_cell_bg(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def set_cell_borders(cell, sz=4, color="94A3B8"):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        b = OxmlElement(f"w:{edge}")
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), str(sz))
        b.set(qn("w:color"), color)
        borders.append(b)
    tcPr.append(borders)


def set_run(r, *, size=10, bold=False, color=INK, italic=False):
    r.font.name = "Calibri"
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.color.rgb = color


def heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    set_run(r, size=(14 if level == 1 else 12 if level == 2 else 11),
            bold=True, color=BRAND if level <= 2 else INK)
    if level == 1:
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bot = OxmlElement("w:bottom")
        bot.set(qn("w:val"), "single"); bot.set(qn("w:sz"), "6")
        bot.set(qn("w:space"), "1"); bot.set(qn("w:color"), "0E7C86")
        pBdr.append(bot); pPr.append(pBdr)
    return p


def para(doc, text="", *, size=10, bold=False, italic=False, color=INK, align=None, space_after=4):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(space_after)
    if text:
        r = p.add_run(text)
        set_run(r, size=size, bold=bold, italic=italic, color=color)
    return p


def bullet(doc, text, *, size=10):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    set_run(r, size=size)
    return p


def build_table(doc, rows, *, col_widths_cm=None, header_rows=1, first_col_header=False, band=False):
    if not rows:
        return None
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    t.autofit = False
    if col_widths_cm:
        for i, w in enumerate(col_widths_cm):
            for cell in t.columns[i].cells:
                cell.width = Cm(w)
    for r_idx, row in enumerate(rows):
        is_header = r_idx < header_rows
        for c_idx, txt in enumerate(row):
            cell = t.cell(r_idx, c_idx)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_borders(cell)
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run("" if txt is None else str(txt))
            if is_header:
                set_run(r, size=10, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
                set_cell_bg(cell, HDR_BG)
            elif first_col_header and c_idx == 0:
                set_run(r, size=10, bold=True, color=INK)
                set_cell_bg(cell, SUBHDR_BG)
            else:
                set_run(r, size=10)
                if band and r_idx % 2 == 0:
                    set_cell_bg(cell, BAND_BG)
    return t


def fmt_inr(v):
    """1.5e7 → '₹1.50 Cr', 8e5 → '₹8.00 L', 50000 → '₹50,000'."""
    if v is None or v == "" or v is False:
        return "—"
    try:
        n = float(v)
    except (ValueError, TypeError):
        return str(v)
    if n >= 1e7:
        return f"₹{n/1e7:.2f} Cr"
    if n >= 1e5:
        return f"₹{n/1e5:.2f} L"
    return f"₹{n:,.0f}"


def fmt_date(s):
    if not s:
        return "—"
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).strftime("%d-%b-%Y")
    except Exception:
        return str(s)


# ───── build ────────────────────────────────────────────────────────────────
def build(data, out_path):
    doc = Document()
    for s in doc.sections:
        s.top_margin = Cm(1.6); s.bottom_margin = Cm(1.6)
        s.left_margin = Cm(1.8); s.right_margin = Cm(1.8)

    style = doc.styles["Normal"]; style.font.name = "Calibri"; style.font.size = Pt(10)

    # ── Cover ──
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    set_run(p.add_run("GRANULES INDIA LIMITED"), size=11, bold=True, color=MUTED)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(0)
    set_run(p.add_run("Project Charter & Note for Approval (NFA)"), size=18, bold=True, color=BRAND)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    set_run(p.add_run(data.get("title") or "[ Project name ]"), size=14, bold=True, color=INK)

    pcId = next((t.split(":", 1)[1] for t in (data.get("strategicAlignmentTags") or []) if isinstance(t, str) and t.startswith("PC_ID:")), None)
    rev_label = f"Revision {data.get('revision', 1)}"
    sub = f"{pcId or '—'}  ·  {rev_label}  ·  Generated {datetime.utcnow().strftime('%d-%b-%Y')}"
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(14)
    set_run(p.add_run(sub), size=10, italic=True, color=MUTED)

    # 1. Project Information
    heading(doc, "1. Project Information", level=2)
    info_rows = [
        ["Note No", data.get("noteNo") or "—", "Entity", data.get("entity") or "—"],
        ["Category", data.get("category") or "—", "Department", data.get("department") or "—"],
        ["Location", data.get("location") or "—", "Note Date", fmt_date(data.get("noteDate"))],
        ["Start Date", fmt_date(data.get("startDate")), "End Date", fmt_date(data.get("endDate"))],
        ["Kind", (data.get("kind") or "—").upper(), "Status", (data.get("status") or "—").replace("_", " ").title()],
    ]
    build_table(doc, info_rows, col_widths_cm=[3.6, 5.0, 3.6, 5.4], header_rows=0, first_col_header=True)

    # 2. Executive Summary
    heading(doc, "2. Executive Summary", level=1)
    para(doc, data.get("executiveSummary") or "—")

    # 3. Project Description
    heading(doc, "3. Project Description", level=1)
    para(doc, data.get("description") or "—")

    # 4. Background
    heading(doc, "4. Background", level=1)
    if data.get("background"):
        para(doc, data["background"])
    heading(doc, "4.1 Current State Assessment", level=2)
    para(doc, data.get("currentState") or "—")
    heading(doc, "4.2 Business Drivers", level=2)
    para(doc, data.get("businessDrivers") or "—")

    # 5. Scope
    heading(doc, "5. Project Scope & Deliverables", level=1)
    heading(doc, "5.1 In Scope", level=2)
    para(doc, data.get("scope") or "—")
    heading(doc, "5.2 Out of Scope", level=2)
    para(doc, data.get("outOfScope") or "—")
    if data.get("deliverables"):
        heading(doc, "5.3 Deliverables", level=2)
        para(doc, data["deliverables"])

    # 6. Benefits & KPIs
    heading(doc, "6. Benefits & KPIs", level=1)
    kpis = data.get("kpis") or []
    if kpis:
        rows = [["KPI", "Baseline", "Goal"]]
        for k in kpis:
            rows.append([k.get("kpi", ""), k.get("baseline", ""), k.get("goal", "")])
        build_table(doc, rows, col_widths_cm=[8.4, 4.4, 4.8], band=True)
    else:
        para(doc, "No KPIs captured.", italic=True, color=MUTED)

    qualitative = [
        ("Topline improvement", data.get("toplineImprovement")),
        ("Bottom-line optimization", data.get("bottomLineOptimization")),
        ("Compliance benefits", data.get("complianceBenefits")),
        ("Productivity improvement", data.get("productivityImprovement")),
    ]
    if any(v for _, v in qualitative):
        heading(doc, "6.1 Qualitative benefits", level=2)
        for label, val in qualitative:
            if val:
                para(doc, f"{label}: ", bold=True, space_after=1)
                para(doc, val, space_after=4)

    # 7. Business Case & ROI / Annum
    heading(doc, "7. Business Case & ROI / Annum", level=1)
    roi = data.get("roiPerAnnum")
    payback = data.get("paybackMonths")
    if roi or payback:
        roi_rows = [["Metric", "Value"]]
        if roi: roi_rows.append(["ROI / Annum", fmt_inr(roi)])
        if payback: roi_rows.append(["Payback (months)", str(payback)])
        if data.get("totalUsd"): roi_rows.append(["Total commitment (USD)", data["totalUsd"]])
        if data.get("totalInr"): roi_rows.append(["Total commitment (INR)", data["totalInr"]])
        build_table(doc, roi_rows, col_widths_cm=[6.0, 11.6], band=True)
    else:
        para(doc, "ROI / payback not quantified.", italic=True, color=MUTED)
    if data.get("recommendation"):
        heading(doc, "7.1 Recommendation", level=2)
        para(doc, data["recommendation"])

    # 8. Implementation Roadmap & Milestones
    heading(doc, "8. Implementation Roadmap & Milestones", level=1)
    milestones = data.get("milestones") or []
    if milestones:
        rows = [["Key Milestone", "Responsible", "Target Date"]]
        for m in milestones:
            rows.append([m.get("milestone", ""), m.get("responsible", ""), m.get("targetDate", "")])
        build_table(doc, rows, col_widths_cm=[9.4, 4.6, 3.6], band=True)
    else:
        para(doc, "No milestones captured.", italic=True, color=MUTED)

    # 9. Revised Project Investment Summary
    heading(doc, "9. Revised Project Investment Summary", level=1)
    invest_rows = [["Metric", "Value", "Remarks"]]
    if data.get("capexAmount"): invest_rows.append(["One-Time Capex", fmt_inr(data["capexAmount"]), ""])
    if data.get("opexAmount"):  invest_rows.append(["Recurring (OPEX)", fmt_inr(data["opexAmount"]), ""])
    fy = data.get("fyRecurring") or []
    for row in fy:
        invest_rows.append([f"Recurring — {row.get('fyLabel','')}", fmt_inr(row.get("amountInr")), ""])
    total_recurring = sum(float(r.get("amountInr", 0) or 0) for r in fy)
    if total_recurring:
        invest_rows.append(["Total Recurring", fmt_inr(total_recurring), "Sum of FY-wise rows"])
    tot = float(data.get("capexAmount") or 0) + total_recurring
    if tot:
        invest_rows.append(["5-Year TCO", fmt_inr(tot), "CAPEX + Recurring"])
    if len(invest_rows) > 1:
        build_table(doc, invest_rows, col_widths_cm=[5.8, 3.6, 8.2], band=True)
    else:
        para(doc, "No financial breakdown captured.", italic=True, color=MUTED)

    # 10. Earlier vs Revised NFA
    heading(doc, "10. Earlier vs Revised NFA", level=1)
    prev = data.get("previousNfaAmount")
    le = data.get("leAmount")
    if prev or le:
        rows = [["Component", "Earlier NFA", "Revised / LE", "Change"]]
        revised = le if le is not None else tot
        delta = (revised or 0) - (prev or 0)
        rows.append(["Total commitment", fmt_inr(prev), fmt_inr(revised), fmt_inr(delta)])
        build_table(doc, rows, col_widths_cm=[6.4, 3.6, 3.6, 4.0], band=True)
    else:
        para(doc, "First-time NFA — no prior commitment to compare.", italic=True, color=MUTED)

    # 11. Constraints
    heading(doc, "11. Constraints", level=1)
    para(doc, data.get("constraints") or "—")

    # 12. Risks
    heading(doc, "12. Risks", level=1)
    risks = data.get("risks") or []
    if risks:
        for r in risks:
            bullet(doc, f"{r.get('title','')}: {r.get('description','') or ''}".strip(": "))
    else:
        para(doc, "—")

    # 13. Assumptions
    heading(doc, "13. Assumptions", level=1)
    para(doc, data.get("assumptions") or "—")

    # 14. Potential Additional Budget Areas
    heading(doc, "14. Potential Additional Budget Areas", level=1)
    para(doc, data.get("potentialAdditionalBudget") or "—")

    # 15. Project Governance
    heading(doc, "15. Project Governance", level=1)
    sc = data.get("steeringCommittee") or []
    if sc:
        heading(doc, "15.1 Steering Committee", level=2)
        rows = [["Role", "Member"]]
        for m in sc:
            rows.append([m.get("role", ""), f"{m.get('name','')}{' ('+m.get('empCode','')+')' if m.get('empCode') else ''}"])
        build_table(doc, rows, col_widths_cm=[7.0, 10.6], first_col_header=True)
    km = data.get("keyProjectMembers") or []
    if km:
        heading(doc, "15.2 Key Project Members", level=2)
        rows = [["Role", "Member"]]
        for m in km:
            rows.append([m.get("role", ""), f"{m.get('name','')}{' ('+m.get('empCode','')+')' if m.get('empCode') else ''}"])
        build_table(doc, rows, col_widths_cm=[7.0, 10.6], first_col_header=True)
    if not sc and not km:
        para(doc, "Governance roster not captured.", italic=True, color=MUTED)

    # 16. Attachments
    heading(doc, "16. Attachments", level=1)
    atts = data.get("attachments") or []
    if atts:
        for a in atts:
            bullet(doc, f"{a.get('name','')} — {a.get('url','')}".strip(" —"))
    else:
        para(doc, "—")

    # 17. Approval & Sign-off
    heading(doc, "17. Approval & Sign-off", level=1)
    para(doc, "Signatories listed below were resolved via the active DOA matrix at the time of submission.",
         italic=True, color=MUTED, space_after=6)

    sigs = data.get("signatories") or []
    if sigs:
        rows = [["Role", "Name", "Status", "Decided At", "Comment"]]
        for s in sigs:
            rows.append([
                (s.get("role") or "").replace("_", " ").title(),
                s.get("name", "") or "—",
                (s.get("status") or "pending").title(),
                fmt_date(s.get("decidedAt")),
                s.get("comment", "") or "",
            ])
        build_table(doc, rows, col_widths_cm=[3.8, 4.4, 2.4, 3.2, 3.8], band=True)
    else:
        para(doc, "Sign-off block populated on submission — empty in draft mode.", italic=True, color=MUTED)

    # Footer
    para(doc, "", space_after=4)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("Consolidated Project Charter + NFA. Source: pmo_charters (Granules Project Hub)."),
            size=8, italic=True, color=MUTED)

    doc.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()
    with open(args.inp, "r", encoding="utf-8") as f:
        data = json.load(f)
    build(data, args.out)
    print(args.out)


if __name__ == "__main__":
    sys.exit(main())
