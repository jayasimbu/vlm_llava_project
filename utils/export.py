"""
backend/utils/export.py
Excel and JSON export utilities.
Source: Final_project-main/backend/utils.py (export functions extracted)
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook


def _safe_filename(value: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in {"-", "_"} else "_" for c in value.strip())
    return cleaned or "document"


def export_to_excel(extracted_data: dict[str, Any], output_dir: Path, base_filename: str) -> Path:
    """Export extracted invoice fields to an Excel (.xlsx) file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(base_filename)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = output_dir / f"{safe_name}_{timestamp}.xlsx"

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Extraction"

    # Write all extracted fields as key/value columns
    headers = list(extracted_data.keys())
    values = [str(extracted_data.get(h, "")) for h in headers]
    worksheet.append(headers)
    worksheet.append(values)
    workbook.save(file_path)
    return file_path


def save_layout_json(data: dict[str, Any], output_dir: Path, base_filename: str) -> Path:
    """Save the full extraction payload as a formatted JSON file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(base_filename)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = output_dir / f"{safe_name}_layout_data_{timestamp}.json"
    file_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return file_path
