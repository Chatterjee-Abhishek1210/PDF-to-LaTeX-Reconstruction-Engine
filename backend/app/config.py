"""
Application configuration settings.
"""
import os
import shutil
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"
SAVE_DIR = BASE_DIR / "saves"  # Persistent document saves

# Create directories if they don't exist
for d in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR, SAVE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# API settings
API_TITLE = "PDF-to-LaTeX Reconstruction Engine"
API_VERSION = "1.0.0"
API_DESCRIPTION = "AI-powered PDF-to-LaTeX conversion with near pixel-perfect fidelity"

# PDF processing settings
MAX_FILE_SIZE_MB = 100
SUPPORTED_EXTENSIONS = [".pdf"]
DPI_FOR_COMPARISON = 300
DPI_FOR_PREVIEW = 150

# LaTeX compiler settings
LATEX_COMPILER = "xelatex"  # xelatex for better font support
LATEX_TIMEOUT = 120  # seconds

# Pandoc settings (for LaTeX → DOCX conversion)
PANDOC_PATH = os.getenv("PANDOC_PATH", shutil.which("pandoc") or "pandoc")

# CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
