"""
VLM LLaVA Invoice Intelligence — Server Launcher
Starts the FastAPI backend server.
"""
import uvicorn
from app.main import app  # Expose app for Railway deployment

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
