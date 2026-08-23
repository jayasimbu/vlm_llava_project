from __future__ import annotations

import io
import os
import uuid
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from config.settings import MOCK_INFERENCE
from core.cleaner import clean_output
from core.extractor import extract_data
from utils.invoice_qa import answer_invoice_question

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "app" / "static"
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
DATA_DIR = PROJECT_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"

app = FastAPI(
    title="VLM Invoice Intelligence API",
    description="AI-Powered Invoice Extraction & Q&A using Vision-Language Models",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str
    invoice_data: dict


class AskResponse(BaseModel):
    question: str
    answer: str


def _safe_filename(filename: Optional[str]) -> str:
    if not filename:
        return f"invoice_{uuid.uuid4().hex}.png"
    return Path(filename).name


def _ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── Health Check ──────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "mock_mode": MOCK_INFERENCE}


# ── Invoice Extraction ────────────────────────────────────────
@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    lang: str = Form("en")
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload a valid image file")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Unable to read image") from exc

    raw = extract_data(image, lang=lang)
    clean = clean_output(raw)

    user_folder = UPLOAD_DIR / "processed"
    user_folder.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid.uuid4().hex}_{_safe_filename(file.filename)}"
    stored_path = user_folder / stored_name
    stored_path.write_bytes(image_bytes)
    stored_file_url = f"/uploads/processed/{stored_name}"

    return {
        "status": "success",
        "data": clean,
        "mock_mode": MOCK_INFERENCE,
        "file_name": _safe_filename(file.filename),
        "file_url": stored_file_url
    }


# ── Invoice Q&A ──────────────────────────────────────────────
@app.post("/ask", response_model=AskResponse)
async def ask_invoice_question_endpoint(payload: AskRequest):
    answer = answer_invoice_question(payload.invoice_data, payload.question)
    return {
        "question": payload.question,
        "answer": str(answer),
    }


# ── Google Sheets Export ──────────────────────────────────────
@app.post("/api/export/sheets")
async def export_to_sheets(payload: dict):
    try:
        from utils.google_sheets import save_to_sheet
        success = save_to_sheet(payload.get("data", {}))
        if success:
            return {"status": "ok", "message": "Exported to Google Sheets successfully"}
        else:
            raise HTTPException(500, detail="Google Sheets export failed")
    except ImportError:
        raise HTTPException(500, detail="Google Sheets dependencies not installed")
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ── Frontend SPA serving ─────────────────────────────────────
@app.get("/")
async def read_index():
    index_path = FRONTEND_DIST_DIR / "index.html"
    if not index_path.exists():
        index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return JSONResponse({"error": "Frontend not built. Run: cd frontend && npm run build"}, status_code=404)
    return FileResponse(index_path)


# ── Static file mounts ───────────────────────────────────────
STATIC_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIST_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
_ensure_store()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if (FRONTEND_DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="frontend-assets")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# ── Catch-all for SPA routing ─────────────────────────────────
@app.get("/{path:path}")
async def serve_spa(path: str = ""):
    # Try to serve as a static file first
    file_path = FRONTEND_DIST_DIR / path
    if path and file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    # Fall back to index.html for SPA routing
    index_path = FRONTEND_DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not built"}, status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
