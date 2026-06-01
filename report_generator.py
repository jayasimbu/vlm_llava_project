"""
backend/utils/report_generator.py
Generates a notepad-style structured TXT report from the combined extraction payload.
Source: Final_project-main/backend/report_generator.py (import paths updated)
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

NOT_DETECTED = "Not Detected"

HEADER_FIELD_LABELS = {"vendor_name": "Company Name", "invoice_number": "Invoice Number", "invoice_date": "Invoice Date", "phone_number": "Phone Number"}
BODY_FIELD_LABELS   = {"bill_to": "Bill To", "customer_name": "Customer Name", "address": "Address", "gst_number": "GST Number"}
FOOTER_FIELD_LABELS = {"subtotal": "Subtotal", "tax_amount": "Tax", "total_amount": "Grand Total", "payment_mode": "Payment Mode"}


def _normalize_scalar(value: Any) -> str:
    if value is None: return NOT_DETECTED
    if isinstance(value, (int, float)): return str(value)
    if isinstance(value, str):
        cleaned = " ".join(value.split()).strip(" :")
        return NOT_DETECTED if not cleaned or cleaned.lower() in {"not found", "none", "null", "n/a", "na"} else cleaned
    return NOT_DETECTED


def _title_case_document_type(document_type: Any) -> str:
    n = _normalize_scalar(document_type)
    return n if n == NOT_DETECTED else " ".join(p.capitalize() for p in n.replace("_", " ").split())


def _normalize_extracted_data(extracted_data: dict[str, Any]) -> dict[str, str]:
    normalized = {str(k).lower().strip(): _normalize_scalar(v) for k, v in extracted_data.items()}
    alias_map = {
        "company_name": "vendor_name", "supplier_name": "vendor_name",
        "invoice_no": "invoice_number", "date": "invoice_date",
        "invoice_total": "total_amount", "grand_total": "total_amount",
        "tax": "tax_amount", "billing_address": "address",
    }
    for src, tgt in alias_map.items():
        if tgt not in normalized and src in normalized:
            normalized[tgt] = normalized[src]
    return normalized


def _find_region(layout_regions, section_name):
    for r in layout_regions:
        if str(r.get("section", "")).lower() == section_name:
            return r
    return {}


def _find_detected_block(detected_blocks, block_type):
    for b in detected_blocks:
        if str(b.get("block_type", "")).lower() == block_type:
            return b
    return {}


def _extract_labeled_value(lines, keywords):
    for line in lines:
        if not any(kw in line.lower() for kw in keywords): continue
        if ":" in line:
            _, val = line.split(":", 1)
            n = _normalize_scalar(val)
            if n != NOT_DETECTED: return n
        tokens = line.split()
        if len(tokens) > 1:
            n = _normalize_scalar(" ".join(tokens[1:]))
            if n != NOT_DETECTED: return n
    return NOT_DETECTED


def _build_section_fields(normalized_data, section_lines, field_labels):
    fields = []
    for key, label in field_labels.items():
        value = normalized_data.get(key, NOT_DETECTED)
        if value == NOT_DETECTED:
            if key == "gst_number": value = _extract_labeled_value(section_lines, ("gst",))
            elif key == "payment_mode": value = _extract_labeled_value(section_lines, ("payment", "upi", "cash", "card"))
            elif key == "subtotal": value = _extract_labeled_value(section_lines, ("subtotal",))
            elif key == "bill_to": value = _extract_labeled_value(section_lines, ("bill to",))
        fields.append((label, value))
    return fields


def _looks_like_table_line(line):
    lower = line.lower()
    has_kw = any(kw in lower for kw in ("qty", "quantity", "amount", "rate", "price", "description", "item", "total"))
    has_dig = any(c.isdigit() for c in line)
    return has_kw or has_dig


def _build_tabular_lines(normalized_data, table_lines, block_lines):
    candidates = [l.strip() for l in table_lines + block_lines if l.strip()]
    rows = [l for l in candidates if _looks_like_table_line(l) and l.lower() not in {"item", "description", "qty", "amount"}]
    seen, unique_rows = set(), []
    for r in rows:
        if r not in seen: seen.add(r); unique_rows.append(r)
    if unique_rows:
        return [f"Item {i}: {row}" for i, row in enumerate(unique_rows, 1)]
    total = normalized_data.get("total_amount", NOT_DETECTED)
    return [f"Item 1 : Amount summary only | Amount: {total}"] if total != NOT_DETECTED else [f"Item 1 : {NOT_DETECTED}"]


def _position_summary_lines(layout_regions, detected_blocks):
    rl = {str(r.get("section", "")).lower(): r for r in layout_regions}
    bl = {str(b.get("block_type", "")).lower(): b for b in detected_blocks}
    table_block = bl.get("table_region", {})
    table_text = "Item-wise purchase details detected" if table_block.get("content_text") else NOT_DETECTED
    return [
        ("Header", _normalize_scalar(rl.get("header", {}).get("description"))),
        ("Body",   _normalize_scalar(rl.get("body",   {}).get("description"))),
        ("Table",  table_text),
        ("Footer", _normalize_scalar(rl.get("footer", {}).get("description"))),
    ]


def _format_labeled_lines(items):
    if not items: return []
    w = max(len(label) for label, _ in items)
    return [f"{label.ljust(w)} : {_normalize_scalar(value)}" for label, value in items]


def generate_structured_report(payload: dict[str, Any]) -> str:
    extracted_data = _normalize_extracted_data(payload.get("extracted_data", {}))
    doc_layout = payload.get("document_layout_analysis", {})
    layout_regions  = doc_layout.get("layout_regions", [])
    detected_blocks = doc_layout.get("detected_blocks", [])

    header_region = _find_region(layout_regions, "header")
    body_region   = _find_region(layout_regions, "body")
    footer_region = _find_region(layout_regions, "footer")
    table_block   = _find_detected_block(detected_blocks, "table_region")

    header_lines = [l.strip() for l in header_region.get("content_lines", []) if str(l).strip()]
    body_lines   = [l.strip() for l in body_region.get("content_lines",   []) if str(l).strip()]
    footer_lines = [l.strip() for l in footer_region.get("content_lines", []) if str(l).strip()]
    table_lines  = [l.strip() for l in table_block.get("content_lines",   []) if str(l).strip()]

    header_items   = _build_section_fields(extracted_data, header_lines, HEADER_FIELD_LABELS)
    body_items     = _build_section_fields(extracted_data, body_lines,   BODY_FIELD_LABELS)
    footer_items   = _build_section_fields(extracted_data, footer_lines, FOOTER_FIELD_LABELS)
    position_items = _position_summary_lines(layout_regions, detected_blocks)
    tabular_items  = _build_tabular_lines(extracted_data, table_lines, [])

    lines = [
        "DOCUMENT ANALYSIS REPORT", "========================", "",
        f"File Name      : {_normalize_scalar(payload.get('file_name'))}",
        f"Document Type  : {_title_case_document_type(payload.get('document_type'))}",
        "", "1. HEADER SECTION", "-----------------", *_format_labeled_lines(header_items),
        "", "2. BODY SECTION",   "---------------",  *_format_labeled_lines(body_items),
        "", "3. TABULAR CONTENT","------------------", *tabular_items,
        "", "4. FOOTER SECTION", "-----------------", *_format_labeled_lines(footer_items),
        "", "5. POSITION SUMMARY","-------------------",*_format_labeled_lines(position_items),
    ]
    return "\n".join(lines).strip() + "\n"


def save_structured_report(report_text: str, output_dir: Path, base_filename: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in {"-", "_"} else "_" for c in base_filename.strip()) or "document"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = output_dir / f"{safe}_analysis_report_{ts}.txt"
    path.write_text(report_text, encoding="utf-8")
    return path
