"""
Convert Router — Handles PDF-to-LaTeX conversion pipeline.
"""
import os
import asyncio
import logging
import json
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse

from app.config import UPLOAD_DIR, OUTPUT_DIR, SAVE_DIR, LATEX_COMPILER
from app.services.pdf_parser import PDFParser
from app.services.latex_generator import LaTeXGenerator
from app.services.latex_compiler import LaTeXCompiler
from app.services.fidelity_engine import FidelityEngine
from app.utils.helpers import create_output_directory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["convert"])

# In-memory job store (use Redis/DB in production)
jobs = {}


@router.post("/convert/{job_id}")
async def start_conversion(job_id: str):
    """
    Start the PDF-to-LaTeX conversion process.
    """
    # Find the uploaded PDF
    upload_dir = os.path.join(UPLOAD_DIR, job_id)
    if not os.path.exists(upload_dir):
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    pdf_files = [f for f in os.listdir(upload_dir) if f.endswith(".pdf")]
    if not pdf_files:
        raise HTTPException(status_code=404, detail="No PDF file found for this job")

    pdf_path = os.path.join(upload_dir, pdf_files[0])
    output_dir = create_output_directory(str(OUTPUT_DIR), job_id)

    # Initialize job status
    jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Starting conversion...",
        "latex_code": None,
        "pdf_path": pdf_path,
        "output_dir": output_dir,
    }

    # Run conversion in background
    asyncio.create_task(_run_conversion(job_id, pdf_path, output_dir))

    return JSONResponse(content={
        "job_id": job_id,
        "status": "processing",
        "message": "Conversion started"
    })


async def _run_conversion(job_id: str, pdf_path: str, output_dir: str):
    """
    Run the full conversion pipeline asynchronously.
    """
    try:
        # Step 1: Parse PDF
        _update_job(job_id, 5, "parsing", "Parsing PDF structure...")

        parser = PDFParser(pdf_path, output_dir)

        def progress_cb(progress, message):
            _update_job(job_id, int(progress * 0.6), "parsing", message)

        structure = await asyncio.get_event_loop().run_in_executor(
            None, lambda: parser.parse(progress_cb)
        )

        # Step 2: Generate LaTeX
        _update_job(job_id, 65, "generating", "Generating LaTeX code...")

        generator = LaTeXGenerator()
        latex_code = await asyncio.get_event_loop().run_in_executor(
            None, lambda: generator.generate(structure)
        )

        # Save LaTeX file
        tex_path = os.path.join(output_dir, "output.tex")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_code)

        # Save document structure for the Visual Editor
        structure_path = os.path.join(output_dir, "structure.json")
        with open(structure_path, "w", encoding="utf-8") as f:
            f.write(structure.model_dump_json(indent=2))

        jobs[job_id]["latex_code"] = latex_code
        _update_job(job_id, 75, "compiling", "Compiling LaTeX to PDF...")

        # Step 3: Compile LaTeX (optional)
        compiler = LaTeXCompiler(compiler=LATEX_COMPILER)
        compile_result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: compiler.compile(tex_path, output_dir)
        )

        generated_pdf = compile_result.get("pdf_path")

        # Step 4: Visual comparison (if compilation succeeded)
        ssim_score = None
        if generated_pdf and os.path.exists(generated_pdf):
            _update_job(job_id, 90, "comparing", "Computing visual fidelity...")

            fidelity = FidelityEngine()
            comparison = await asyncio.get_event_loop().run_in_executor(
                None, lambda: fidelity.compare(pdf_path, generated_pdf)
            )
            ssim_score = comparison.get("overall_score", 0)

            jobs[job_id]["ssim_score"] = ssim_score
            jobs[job_id]["generated_pdf"] = generated_pdf

        # Complete
        _update_job(job_id, 100, "complete", "Conversion complete!")
        jobs[job_id]["status"] = "complete"

        logger.info(
            f"Job {job_id} complete. SSIM: {ssim_score or 'N/A'}"
        )

    except Exception as e:
        logger.error(f"Conversion failed for job {job_id}: {e}", exc_info=True)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["message"] = f"Conversion failed: {str(e)}"
        jobs[job_id]["progress"] = 0


def _update_job(job_id: str, progress: int, status: str, message: str):
    """Update job progress."""
    if job_id in jobs:
        jobs[job_id]["progress"] = progress
        jobs[job_id]["status"] = status
        jobs[job_id]["message"] = message


@router.get("/status/{job_id}")
async def get_status(job_id: str):
    """
    Get the status of a conversion job.
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    job = jobs[job_id]
    return JSONResponse(content={
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "ssim_score": job.get("ssim_score"),
    })


@router.get("/result/{job_id}")
async def get_result(job_id: str):
    """
    Get the conversion result including LaTeX code.
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    job = jobs[job_id]

    if job["status"] != "complete":
        return JSONResponse(content={
            "job_id": job_id,
            "status": job["status"],
            "message": job["message"],
        })

    return JSONResponse(content={
        "job_id": job_id,
        "status": "complete",
        "latex_code": job.get("latex_code", ""),
        "ssim_score": job.get("ssim_score"),
        "message": "Conversion complete",
    })


@router.websocket("/ws/{job_id}")
async def websocket_progress(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint for real-time conversion progress updates.
    """
    await websocket.accept()

    try:
        last_progress = -1
        while True:
            if job_id in jobs:
                job = jobs[job_id]
                current_progress = job["progress"]

                if current_progress != last_progress:
                    await websocket.send_json({
                        "job_id": job_id,
                        "status": job["status"],
                        "progress": job["progress"],
                        "message": job["message"],
                    })
                    last_progress = current_progress

                if job["status"] in ("complete", "failed"):
                    # Send final message with result
                    await websocket.send_json({
                        "job_id": job_id,
                        "status": job["status"],
                        "progress": job["progress"],
                        "message": job["message"],
                        "ssim_score": job.get("ssim_score"),
                        "latex_code": job.get("latex_code", "")[:500] + "...",
                    })
                    break

            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job {job_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


@router.post("/save/{job_id}")
async def save_document(job_id: str, request: Request):
    """
    Save the current LaTeX source and metadata for a document.
    Used for autosave and explicit save checkpoints.
    """
    try:
        body = await request.json()
        latex_code = body.get("latex_code", "")
        cursor_line = body.get("cursor_line", 1)
        cursor_col = body.get("cursor_col", 1)
        scroll_position = body.get("scroll_position", 0)

        save_dir = os.path.join(str(SAVE_DIR), job_id)
        os.makedirs(save_dir, exist_ok=True)

        # Save LaTeX source
        tex_path = os.path.join(save_dir, "document.tex")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_code)

        # Save metadata
        metadata = {
            "job_id": job_id,
            "cursor_line": cursor_line,
            "cursor_col": cursor_col,
            "scroll_position": scroll_position,
            "saved_at": __import__("datetime").datetime.now().isoformat(),
        }
        meta_path = os.path.join(save_dir, "metadata.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f)

        logger.info(f"Saved document for job {job_id}")
        return JSONResponse(content={
            "status": "saved",
            "job_id": job_id,
            "message": "Document saved successfully",
        })

    except Exception as e:
        logger.error(f"Save failed for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")


@router.get("/load/{job_id}")
async def load_document(job_id: str):
    """
    Load the last saved LaTeX source and metadata for a document.
    Used to restore state on page refresh.
    """
    save_dir = os.path.join(str(SAVE_DIR), job_id)

    # Try loading from save directory first
    tex_path = os.path.join(save_dir, "document.tex")
    meta_path = os.path.join(save_dir, "metadata.json")

    latex_code = ""
    metadata = {}

    if os.path.exists(tex_path):
        with open(tex_path, "r", encoding="utf-8") as f:
            latex_code = f.read()
    else:
        # Fallback: try to load from the original conversion output
        output_tex = os.path.join(str(OUTPUT_DIR), job_id, "output.tex")
        if os.path.exists(output_tex):
            with open(output_tex, "r", encoding="utf-8") as f:
                latex_code = f.read()
        else:
            raise HTTPException(status_code=404, detail=f"No saved document found for job {job_id}")

    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

    return JSONResponse(content={
        "job_id": job_id,
        "latex_code": latex_code,
        "cursor_line": metadata.get("cursor_line", 1),
        "cursor_col": metadata.get("cursor_col", 1),
        "scroll_position": metadata.get("scroll_position", 0),
        "saved_at": metadata.get("saved_at", ""),
    })

