"""
backend/utils/pdf_converter.py
Converts PDF bytes into PIL Images for OCR/VLM processing.
Requires: pip install PyMuPDF
Source: vlm_llava_project/utils/pdf_converter.py
"""
from __future__ import annotations

import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)

try:
    import fitz  # PyMuPDF
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False
    logger.warning("[pdf_converter] PyMuPDF not installed. PDF support disabled. Run: pip install PyMuPDF")


def convert_pdf_to_images(pdf_bytes: bytes, max_pages: int = 5) -> list[Image.Image]:
    """
    Converts a PDF (bytes) into a list of PIL Images.
    Returns empty list if PyMuPDF is not installed or conversion fails.
    """
    if not _PYMUPDF_AVAILABLE:
        return []

    images = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i in range(min(len(doc), max_pages)):
            page = doc.load_page(i)
            # 2x matrix for higher quality rendering
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            images.append(img)
        doc.close()
    except Exception as exc:
        logger.error("[pdf_converter] PDF → Image conversion failed: %s", exc)

    return images


def get_first_page_as_bytes(pdf_bytes: bytes) -> bytes | None:
    """
    Converts the first page of a PDF to PNG bytes for VLM/OCR processing.
    Returns None if conversion fails.
    """
    images = convert_pdf_to_images(pdf_bytes, max_pages=1)
    if not images:
        return None

    buf = io.BytesIO()
    images[0].save(buf, format="PNG")
    return buf.getvalue()


def is_pdf_supported() -> bool:
    """Returns True if PyMuPDF is installed and PDF processing is available."""
    return _PYMUPDF_AVAILABLE
