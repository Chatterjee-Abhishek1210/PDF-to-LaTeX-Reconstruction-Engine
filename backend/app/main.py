"""
PDF-to-LaTeX Reconstruction Engine
Main FastAPI Application

An AI-powered system for converting PDF documents to production-quality
LaTeX source code with near pixel-perfect visual fidelity.
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import (
    API_TITLE, API_VERSION, API_DESCRIPTION,
    FRONTEND_URL, OUTPUT_DIR, UPLOAD_DIR, SAVE_DIR
)
from app.routers import upload, convert, export, save
from app.database import engine, Base
import app.db_models

# Create database tables
Base.metadata.create_all(bind=engine)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for outputs
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
app.mount("/saves", StaticFiles(directory=str(SAVE_DIR)), name="saves")

# Include routers
app.include_router(upload.router)
app.include_router(convert.router)
app.include_router(export.router)
app.include_router(save.router)


@app.get("/")
async def root():
    return {
        "name": API_TITLE,
        "version": API_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
