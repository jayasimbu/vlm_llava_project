from __future__ import annotations
import sys, os, asyncio, json, logging, shutil, uuid
from pathlib import Path
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path: sys.path.insert(0, str(_PROJECT_ROOT))

from backend.auth.routes import router as auth_router, get_current_user_optional
from backend.config import *
from backend.pipeline import run_pipeline
from backend.db.connection import ping_db
from backend.db.repository import delete_result, get_result, list_results

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)

_job_store = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safe Mode Startup
    logger.info("[startup] Backend ready.")
    
    # Pre-populate vlm_settings.json from MongoDB on startup if available
    try:
        from backend.db.connection import ping_db, get_async_db
        if await ping_db():
            db_conn = get_async_db()
            if db_conn is not None:
                doc = await db_conn["settings"].find_one({"key": "vlm_url"})
                if doc and doc.get("value"):
                    settings_file = GUEST_DIR / "vlm_settings.json"
                    GUEST_DIR.mkdir(parents=True, exist_ok=True)
                    with open(settings_file, "w", encoding="utf-8") as f:
                        json.dump({"vlm_url": doc["value"]}, f, ensure_ascii=False, indent=4)
                    logger.info(f"[startup] Loaded VLM URL from DB: {doc['value']}")
    except Exception as e:
        logger.warning(f"[startup] Failed to pre-populate VLM URL from DB: {e}")
    yield

app = FastAPI(title=API_TITLE, description=API_DESCRIPTION, version=API_VERSION, lifespan=lifespan)
app.include_router(auth_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Ensure static directories exist before mounting
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
GUEST_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/tmp", StaticFiles(directory=GUEST_DIR), name="tmp")

@app.get("/api/health")
async def health(): return {"status": "ok", "db": await ping_db()}

@app.post("/api/upload")
async def upload(files: List[UploadFile] = File(...), user_email: str = Depends(get_current_user_optional)):
    job_id = str(uuid.uuid4())
    target_dir = (UPLOAD_DIR / user_email) if user_email else (UPLOAD_DIR / "tmp" / job_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    file_infos = []
    for idx, file in enumerate(files, start=1):
        content = await file.read()
        file_path = target_dir / f"{idx:04d}_{file.filename}"
        file_path.write_bytes(content)
        file_infos.append({"path": str(file_path), "bytes": content, "name": file.filename, "idx": idx})
    _job_store[job_id] = {"files": file_infos, "user_email": user_email}
    return {"job_id": job_id}

@app.get("/api/stream/{job_id}")
async def stream(job_id: str):
    if job_id not in _job_store:
        raise HTTPException(404)
    job = _job_store[job_id]
    async def gen():
        try:
            for idx, info in enumerate(job["files"], start=1):
                # Emit stage event before processing each segment
                stage_msg = json.dumps({
                    "event": "stage",
                    "image": idx,
                    "stage": f"Processing segment {idx}/{len(job['files'])}"
                }, ensure_ascii=False)
                yield f"data: {stage_msg}\n\n"
                
                # Start pipeline as an asynchronous task
                task = asyncio.create_task(run_pipeline(
                    info["path"], info["bytes"], info["name"],
                    user_email=job["user_email"], session_id=job_id
                ))
                
                # Send periodic keep-alive pings while waiting for the task
                while not task.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(task), timeout=15.0)
                    except asyncio.TimeoutError:
                        # Send standard SSE comment as keep-alive heartbeat
                        yield ": ping\n\n"
                
                res = await task
                
                # Emit result event with image index
                result_msg = json.dumps({
                    "event": "result",
                    "image": idx,
                    "data": res
                }, ensure_ascii=False)
                yield f"data: {result_msg}\n\n"
            # Done event
            done_msg = json.dumps({"event": "done"}, ensure_ascii=False)
            yield f"data: {done_msg}\n\n"
        finally:
            # Cleanup job entry after streaming finishes (whether success or error)
            _job_store.pop(job_id, None)
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@app.post("/api/filter")
async def filter_api(payload: dict):
    from backend.vlm.gguf_engine import query_local_llava
    from backend.vlm.vlm_model import _clean_output
    prompt, data = payload.get("prompt"), payload.get("data")
    res = await asyncio.to_thread(query_local_llava, b"", f"Filter this JSON based on '{prompt}': {json.dumps(data)}", INTERNAL_MODEL_API_KEY)
    return _clean_output(res) or data

@app.post("/api/translate")
async def translate_api(payload: dict):
    import re
    from backend.vlm.gguf_engine import query_local_llava
    text = payload.get("text")
    target_lang = payload.get("target_lang")
    if not text or not target_lang:
        raise HTTPException(400, detail="Both 'text' and 'target_lang' are required.")
    
    prompt = (
        f"You are a professional document translator.\n"
        f"Translate the following invoice/receipt text details into {target_lang.upper()}.\n"
        f"Preserve the document structure, columns, alignment, and spacing exactly.\n"
        f"Do NOT summarize, do NOT omit values or details, and do NOT add any greeting or explanation.\n"
        f"Output ONLY the translated document:\n\n{text}"
    )
    
    res = await asyncio.to_thread(query_local_llava, b"", prompt, INTERNAL_MODEL_API_KEY)
    
    cleaned = res
    if cleaned:
        cleaned = re.sub(r'^```[a-zA-Z]*\n', '', cleaned)
        cleaned = re.sub(r'\n```$', '', cleaned)
        cleaned = cleaned.strip()
        
    return {"translated_text": cleaned}


@app.get("/api/results")
async def history(user_email: str = Depends(get_current_user_optional)): 
    return {"results": await list_results(limit=20, user_email=user_email)}

@app.get("/api/results/search")
async def search_api(q: str, user_email: str = Depends(get_current_user_optional)):
    from backend.db.repository import search_results
    return {"results": await search_results(q, user_email=user_email, limit=30)}

@app.delete("/api/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    if job_id in _job_store:
        del _job_store[job_id]
    return {"status": "ok", "message": "Cleanup successful"}

# Settings routes to dynamically set/get the VLM URL
@app.post("/api/settings/vlm_url")
async def set_vlm_url(payload: dict):
    url = payload.get("vlm_url")
    if not url:
        raise HTTPException(400, detail="vlm_url is required")
    try:
        # Write to settings JSON file
        settings_file = GUEST_DIR / "vlm_settings.json"
        GUEST_DIR.mkdir(parents=True, exist_ok=True)
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump({"vlm_url": url}, f, ensure_ascii=False, indent=4)
        
        # Try updating MongoDB if available
        try:
            from backend.db.connection import ping_db, get_async_db
            if await ping_db():
                db_conn = get_async_db()
                if db_conn is not None:
                    await db_conn["settings"].update_one(
                        {"key": "vlm_url"},
                        {"$set": {"value": url}},
                        upsert=True
                    )
                    logger.info("Saved VLM URL to database settings collection")
        except Exception as dbe:
            logger.warning(f"Failed to update MongoDB with new VLM URL: {dbe}")
            
        logger.info(f"VLM URL successfully updated to: {url}")
        return {"status": "ok", "vlm_url": url}
    except Exception as e:
        logger.error(f"Failed to save VLM URL: {e}")
        raise HTTPException(500, detail=str(e))

@app.get("/api/settings/vlm_url")
async def get_vlm_url():
    settings_file = GUEST_DIR / "vlm_settings.json"
    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("vlm_url"):
                    return {"vlm_url": data["vlm_url"]}
        except Exception:
            pass
            
    # Try fetching from DB
    try:
        from backend.db.connection import ping_db, get_async_db
        if await ping_db():
            db_conn = get_async_db()
            if db_conn is not None:
                doc = await db_conn["settings"].find_one({"key": "vlm_url"})
                if doc and doc.get("value"):
                    return {"vlm_url": doc["value"]}
    except Exception:
        pass
                
    return {"vlm_url": KAGGLE_VLM_URL}

@app.get("/")
@app.get("/{path:path}")
async def serve(path: str = ""):
    index = FRONTEND_DIST_DIR / "index.html"
    if path and (FRONTEND_DIST_DIR / path).exists(): return FileResponse(FRONTEND_DIST_DIR / path)
    return FileResponse(index) if index.exists() else {"error": "Frontend missing"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
