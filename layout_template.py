"""
backend/utils/layout_template.py

INVOICE LAYOUT TEMPLATE MAPPER
================================
Converts any VLM/OCR extraction result into a STANDARDIZED output where each field
always appears at the same position in the document — regardless of the source invoice's
language, style, or quality (including handwritten/unclear images).

CONCEPT:
  - Real invoices all share the same SPATIAL ZONES (top-left=vendor, top-right=invoice#, etc.)
  - VLM extracts raw field values from image
  - This module maps those values onto a fixed positional template
  - Output is always consistent: same field names, same order, same structure

ADVANTAGE FOR HANDWRITTEN/UNCLEAR IMAGES:
  - Even if OCR reads garbled text, VLM can infer fields from position
  - Template forces a complete output with all expected fields (empty if not found)
  - Downstream systems always receive the same schema regardless of image quality

STANDARD INVOICE ZONES (spatial reference):
  ┌─────────────────────────────────────────────────┐
  │ [TOP-LEFT]          │  [TOP-RIGHT]              │
  │  Vendor Name        │   Invoice Number          │
  │  Vendor Address     │   Invoice Date            │
  │  Vendor GSTIN       │   Due Date                │
  │├─────────────────────────────────────────────────┤
  │ [MID-LEFT]          │  [MID-RIGHT]              │
  │  Bill To (Buyer)    │   Ship To                 │
  │  Buyer Address      │   PO Number               │
  │  Buyer GSTIN        │                           │
  │├─────────────────────────────────────────────────┤
  │ [CENTER - TABLE]                                │
  │  Item | Qty | Rate | HSN | Tax | Amount         │
  │├─────────────────────────────────────────────────┤
  │ [BOTTOM-RIGHT]                                  │
  │  Subtotal / Taxable Amount                      │
  │  CGST / SGST / IGST                             │
  │  Total Amount                                   │
  └─────────────────────────────────────────────────┘
"""
from __future__ import annotations
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── STANDARD TEMPLATE SCHEMA ──────────────────────────────────────────────────
# Each entry: (canonical_field_name, zone, aliases_to_search_in_raw_extraction)
INVOICE_TEMPLATE: list[tuple[str, str, list[str]]] = [
    # ── VENDOR / SELLER (Top-Left) ────────────────────────────────────────────
    ("vendor_name",        "top_left",     ["vendor/shop name", "vendor", "seller", "from", "company", "firm", "shop", "store", "biller", "issued_by", "supplier"]),
    ("vendor_address",     "top_left",     ["address", "vendor_address", "seller_address", "from_address", "office_address"]),
    ("vendor_gstin",       "top_left",     ["phone / gstin / tax id", "gstin", "gst", "gst_number", "gstin_number", "vendor_gstin", "seller_gstin", "tax_id"]),
    ("vendor_phone",       "top_left",     ["phone / gstin / tax id", "phone", "mobile", "contact", "tel", "telephone", "vendor_phone"]),
    ("vendor_email",       "top_left",     ["email", "e-mail", "vendor_email"]),

    # ── INVOICE META (Top-Right) ───────────────────────────────────────────────
    ("invoice_number",     "top_right",    ["bill no / customer id", "invoice_number", "invoice_no", "bill_number", "bill_no", "receipt_no", "challan_no", "ref_no"]),
    ("invoice_date",       "top_right",    ["date", "invoice_date", "bill_date", "issued_date", "dated"]),
    ("due_date",           "top_right",    ["due_date", "payment_due", "pay_by"]),
    ("po_number",          "top_right",    ["po_number", "purchase_order", "order_number", "po_no"]),

    # ── BUYER / BILL-TO (Mid-Left) ────────────────────────────────────────────
    ("buyer_name",         "mid_left",     ["buyer", "bill_to", "customer", "client", "consignee", "to", "billed_to", "sold_to"]),
    ("buyer_address",      "mid_left",     ["buyer_address", "bill_to_address", "customer_address", "delivery_address"]),
    ("buyer_gstin",        "mid_left",     ["buyer_gstin", "customer_gstin", "bill_to_gstin"]),

    # ── LINE ITEMS (Center Table) ─────────────────────────────────────────────
    ("items",              "center",       ["items", "line_items", "products", "goods", "services", "description", "particulars"]),

    # ── TAX SUMMARY (Bottom-Right) ────────────────────────────────────────────
    ("subtotal",           "bottom_right", ["subtotal", "taxable_amount", "taxable_value", "net_amount", "before_tax"]),
    ("cgst",               "bottom_right", ["cgst", "central_gst", "cgst_amount"]),
    ("sgst",               "bottom_right", ["sgst", "state_gst", "sgst_amount"]),
    ("igst",               "bottom_right", ["igst", "integrated_gst", "igst_amount"]),
    ("total_tax",          "bottom_right", ["total_tax", "tax_total", "gst_total", "vat"]),
    ("total_amount",       "bottom_right", ["total amount", "total", "grand_total", "total_amount", "net_total", "amount_due", "bill_total", "payable", "final_amount"]),
    ("amount_in_words",    "bottom_right", ["amount_in_words", "in_words", "rupees_in_words", "total_words"]),

    # ── PAYMENT INFO (Bottom) ─────────────────────────────────────────────────
    ("bank_name",          "bottom",       ["bank", "bank_name"]),
    ("account_number",     "bottom",       ["account_number", "account_no", "acc_no", "bank_account"]),
    ("ifsc",               "bottom",       ["ifsc", "ifsc_code", "bank_ifsc"]),
    ("upi",                "bottom",       ["upi", "upi_id", "gpay", "phonepe"]),

    # ── MISC ──────────────────────────────────────────────────────────────────
    ("notes",              "footer",       ["notes", "terms", "conditions", "remarks", "note"]),
]

# Zone display order for the standardized output
ZONE_ORDER = ["top_left", "top_right", "mid_left", "center", "bottom_right", "bottom", "footer"]
ZONE_LABELS = {
    "top_left":     "VENDOR / SELLER",
    "top_right":    "INVOICE DETAILS",
    "mid_left":     "BUYER / BILL TO",
    "center":       "LINE ITEMS",
    "bottom_right": "TAX & TOTALS",
    "bottom":       "PAYMENT INFO",
    "footer":       "NOTES & TERMS",
}


def _normalize_key(key: str) -> str:
    """Normalize a key for fuzzy alias matching."""
    return key.lower().strip().replace(" ", "_").replace("-", "_").replace(".", "")


def _flatten_dict(d: dict[str, Any], parent_key: str = '') -> dict[str, Any]:
    items: list[tuple[str, Any]] = []
    if isinstance(d, list):
        return {parent_key: d}
    for k, v in d.items():
        new_key = f"{parent_key}_{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(_flatten_dict(v, new_key).items())
        else:
            items.append((new_key, v))
    return dict(items)

def _find_value(raw: dict[str, Any], aliases: list[str]) -> Any:
    """
    Search the raw extraction dict for a value matching any of the given aliases.
    Handles nested dicts and case-insensitive keys.
    Returns the first match found, or None.
    """
    if not isinstance(raw, dict): return None
    flat_raw = _flatten_dict(raw)
    
    # Build normalized key map
    norm_map = {_normalize_key(k): v for k, v in flat_raw.items()}

    for alias in aliases:
        norm_alias = _normalize_key(alias)
        # Direct match
        if norm_alias in norm_map:
            val = norm_map[norm_alias]
            if val and str(val).strip():
                return val
        # Partial match: alias is substring of a key or vice versa
        for norm_k, v in norm_map.items():
            if (norm_alias in norm_k or norm_k in norm_alias) and v and str(v).strip():
                return v

    # Last resort: check if the value appears in a "full_extraction" text blob
    full_text = raw.get("full_extraction", "")
    return None


def _extract_from_full_text(full_text: str, aliases: list[str]) -> str | None:
    """
    When raw extraction has a 'full_extraction' text blob (not structured),
    try to find a field value by looking for known label patterns.
    e.g., 'Invoice No: 1234' → '1234'
    """
    if not full_text:
        return None
    import re
    for alias in aliases:
        # Pattern: "alias: value" or "alias - value" on a line
        pattern = rf'(?i){re.escape(alias.replace("_", "[ _-]"))}[\s:.\-]+([^\n]+)'
        match = re.search(pattern, full_text)
        if match:
            val = match.group(1).strip().rstrip(",;")
            if val:
                return val
    return None


def _parse_markdown_table(full_text: str) -> list[dict[str, str]]:
    """
    Parse a markdown table from the Digital Twin text into a list of dicts.
    Look for | Header | style lines.
    """
    import re
    lines = full_text.splitlines()
    table_lines = [l.strip() for l in lines if l.strip().startswith("|")]
    
    if len(table_lines) < 3: # Need header, separator, and at least one row
        return []
    
    # Simple parser: assume first line is header, second is separator
    try:
        header_raw = table_lines[0].strip("|").split("|")
        headers = [h.strip().lower() for h in header_raw]
        
        rows = []
        for line in table_lines[2:]:
            if "---" in line: continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) >= len(headers):
                row = {headers[i]: cells[i] for i in range(len(headers))}
                rows.append(row)
        return rows
    except Exception:
        return []


def map_to_standard_template(raw_extraction: dict[str, Any]) -> dict[str, Any]:
    """
    Map any raw VLM extraction result to the standard invoice template.

    Args:
        raw_extraction: Raw dict from VLM (any key names, any structure)

    Returns:
        Standardized dict with canonical field names, always same structure.
        Empty string for fields not found.
    """
    # Handle the case where VLM returned a 'full_extraction' text blob
    full_text = raw_extraction.get("full_extraction", "")
    is_text_blob = bool(full_text) and len(raw_extraction) <= 4

    result: dict[str, Any] = {}
    matched_count = 0

    for field_name, zone, aliases in INVOICE_TEMPLATE:
        val = None
        if field_name == "items" and full_text:
            # Special handling for table parsing from Digital Twin markdown
            val = _parse_markdown_table(full_text)
            
        if not val and not is_text_blob:
            val = _find_value(raw_extraction, aliases)
            
        if not val and full_text:
            val = _extract_from_full_text(full_text, aliases + [field_name])
            
        result[field_name] = val or ""
        if val:
            matched_count += 1

    # If nothing matched and we have a full_text blob, preserve it under a special key
    if matched_count == 0 and full_text:
        result["_raw_text"] = full_text
        logger.info("[layout_template] No structured fields found. Preserving raw text blob.")
    else:
        logger.info("[layout_template] Mapped %d/%d fields from extraction.", matched_count, len(INVOICE_TEMPLATE))

    result["_template_version"] = "invoice_v1"
    return result


def format_standardized_output(mapped: dict[str, Any]) -> str:
    """
    Format the mapped fields into a human-readable standardized text output.
    Fields always appear in the same zone order — consistent across all invoices.
    Empty fields are shown as '—' to maintain the template structure.
    """
    lines = ["=" * 60, "  STANDARDIZED INVOICE EXTRACTION", "=" * 60]

    # Group by zone
    zone_fields: dict[str, list[tuple[str, str, Any]]] = {z: [] for z in ZONE_ORDER}
    for field_name, zone, aliases in INVOICE_TEMPLATE:
        val = mapped.get(field_name, "")
        zone_fields[zone].append((field_name, aliases[0].replace("_", " ").title(), val))

    for zone in ZONE_ORDER:
        fields = zone_fields[zone]
        if not fields:
            continue
        # Skip empty zones
        if all(not v for _, _, v in fields):
            continue
        lines.append(f"\n[{ZONE_LABELS[zone]}]")
        lines.append("-" * 40)
        for field_name, label, val in fields:
            display_val = str(val).strip() if val else "\u2014"
            lines.append(f"  {label:<25} {display_val}")

    # Raw text fallback
    raw_text = mapped.get("_raw_text", "")
    if raw_text:
        lines.append("\n[RAW EXTRACTED TEXT]")
        lines.append("-" * 40)
        lines.append(raw_text[:2000])

    lines.append("\n" + "=" * 60)
    return "\n".join(lines)
