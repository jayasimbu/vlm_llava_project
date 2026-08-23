"""
VLM LLaVA Invoice Intelligence — Server Launcher
Starts the FastAPI backend server on port 8000.
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
