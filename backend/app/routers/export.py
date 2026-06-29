"""
Export Router — Handles exporting LaTeX code, compiled PDF, and ZIP packages.
Also provides on-demand compile-and-download for edited LaTeX source.
"""
import pdfplumber
import os
import subprocess
import logging
import shutil
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from app.config import OUTPUT_DIR, PANDOC_PATH, LATEX_COMPILER, LATEX_TIMEOUT
from app.utils.helpers import create_zip_package

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["export"])


@router.get("/structure/{job_id}")
async def get_structure(job_id: str):
    """
    Return the extracted document structure for the Visual Editor.
    This contains exact x,y positions, font sizes, colors from the original PDF.
    """
    structure_path = os.path.join(str(OUTPUT_DIR), job_id, "structure.json")

    if not os.path.exists(structure_path):
        raise HTTPException(status_code=404, detail="Document structure not found")

    import json
    with open(structure_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return JSONResponse(content=data)


@router.get("/export/tex/{job_id}")
async def export_tex(job_id: str):
    """
    Download the generated LaTeX source file.
    """
    tex_path = os.path.join(str(OUTPUT_DIR), job_id, "output.tex")

    if not os.path.exists(tex_path):
        raise HTTPException(status_code=404, detail="LaTeX file not found")

    return FileResponse(
        tex_path,
        media_type="application/x-tex",
        filename=f"{job_id}_output.tex",
    )


@router.get("/export/pdf/{job_id}")
async def export_pdf(job_id: str):
    """
    Download the compiled PDF.
    """
    pdf_path = os.path.join(str(OUTPUT_DIR), job_id, "output.pdf")

    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Compiled PDF not found")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{job_id}_output.pdf",
    )


@router.get("/export/docx/{job_id}")
async def export_docx(job_id: str):
    """
    Download the generated content as a Word document (.docx).
    """
    pdf_path = os.path.join(str(OUTPUT_DIR), job_id, "output.pdf")
    docx_path = os.path.join(str(OUTPUT_DIR), job_id, "output.docx")

    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="Compiled PDF not found")

    # If DOCX doesn't exist yet, convert it on the fly
    if not os.path.exists(docx_path):
        try:
            from pdf2docx import Converter
            cv = Converter(pdf_path)
            cv.convert(docx_path, start=0, end=None)
            cv.close()
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            logger.error(f"Failed to convert PDF to DOCX: {error_trace}")
            raise HTTPException(status_code=500, detail=f"Failed to generate Word document: {str(e)}")

    return FileResponse(
        docx_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{job_id}_output.docx",
    )


@router.get("/export/zip/{job_id}")
async def export_zip(job_id: str):
    """
    Download complete LaTeX package as ZIP (tex + images + PDF).
    """
    output_dir = os.path.join(str(OUTPUT_DIR), job_id)

    if not os.path.exists(output_dir):
        raise HTTPException(status_code=404, detail="Output directory not found")

    zip_path = create_zip_package(output_dir, job_id)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{job_id}_latex_package.zip",
    )


@router.get("/export/original/{job_id}")
async def get_original_pdf(job_id: str):
    """
    Serve the original uploaded PDF for side-by-side comparison.
    """
    from app.config import UPLOAD_DIR
    upload_dir = os.path.join(str(UPLOAD_DIR), job_id)

    if not os.path.exists(upload_dir):
        raise HTTPException(status_code=404, detail="Original PDF not found")

    pdf_files = [f for f in os.listdir(upload_dir) if f.endswith(".pdf")]
    if not pdf_files:
        raise HTTPException(status_code=404, detail="No PDF file found")

    return FileResponse(
        os.path.join(upload_dir, pdf_files[0]),
        media_type="application/pdf",
        filename=f"original_{pdf_files[0]}",
    )


@router.get("/preview/{job_id}/{page_num}")
async def get_page_preview(job_id: str, page_num: int = 0):
    """
    Get a page preview image of the original PDF.
    """
    import pdfplumber
    from app.config import UPLOAD_DIR, DPI_FOR_PREVIEW

    upload_dir = os.path.join(str(UPLOAD_DIR), job_id)
    pdf_files = [f for f in os.listdir(upload_dir) if f.endswith(".pdf")]

    if not pdf_files:
        raise HTTPException(status_code=404, detail="PDF not found")

    pdf_path = os.path.join(upload_dir, pdf_files[0])
    output_dir = os.path.join(str(OUTPUT_DIR), job_id)
    os.makedirs(output_dir, exist_ok=True)

    preview_path = os.path.join(output_dir, f"preview_p{page_num}.png")

    if not os.path.exists(preview_path):
        with pdfplumber.open(pdf_path) as doc:
            if page_num >= len(doc.pages):
                raise HTTPException(status_code=404, detail="Page not found")

            page = doc.pages[page_num]
            im = page.to_image(resolution=DPI_FOR_PREVIEW)
            im.save(preview_path)

    return FileResponse(preview_path, media_type="image/png")


@router.get("/preview-compiled/count/{job_id}")
async def get_compiled_page_count(job_id: str):
    """
    Get the total number of pages in the compiled output PDF.
    """
    import fitz
    from app.config import OUTPUT_DIR

    compile_dir = os.path.join(str(OUTPUT_DIR), job_id, "compile_workspace")
    pdf_path = os.path.join(compile_dir, "document.pdf")

    if not os.path.exists(pdf_path):
        # Fallback to output.pdf if available (from initial generation)
        pdf_path = os.path.join(str(OUTPUT_DIR), job_id, "output.pdf")
        if not os.path.exists(pdf_path):
            # Fallback to original if not compiled yet
            from app.config import UPLOAD_DIR
            upload_dir = os.path.join(str(UPLOAD_DIR), job_id)
            if not os.path.exists(upload_dir):
                return JSONResponse({"count": 0})
            pdf_files = [f for f in os.listdir(upload_dir) if f.endswith(".pdf")]
            if not pdf_files:
                return JSONResponse({"count": 0})
            pdf_path = os.path.join(upload_dir, pdf_files[0])

    try:
        with pdfplumber.open(pdf_path) as doc:
            count = len(doc.pages)
            return JSONResponse({"count": count})
    except Exception as e:
        print(f"Error counting pages: {e}")
        return JSONResponse({"count": 0})


@router.get("/preview-compiled/{job_id}/{page_num}")
async def get_compiled_page_preview(job_id: str, page_num: int = 0, t: str = None):
    """
    Get a page preview image of the compiled PDF.
    """
    import pdfplumber
    from app.config import OUTPUT_DIR, UPLOAD_DIR, DPI_FOR_PREVIEW

    output_dir = os.path.join(str(OUTPUT_DIR), job_id)
    compile_dir = os.path.join(output_dir, "compile_workspace")
    pdf_path = os.path.join(compile_dir, "document.pdf")

    # If the output PDF doesn't exist, fallback to output.pdf then original
    if not os.path.exists(pdf_path):
        pdf_path = os.path.join(str(OUTPUT_DIR), job_id, "output.pdf")
        if not os.path.exists(pdf_path):
            upload_dir = os.path.join(str(UPLOAD_DIR), job_id)
            if os.path.exists(upload_dir):
                pdf_files = [f for f in os.listdir(upload_dir) if f.endswith(".pdf")]
                if pdf_files:
                    pdf_path = os.path.join(upload_dir, pdf_files[0])
                else:
                    raise HTTPException(status_code=404, detail="Compiled PDF not found")
            else:
                raise HTTPException(status_code=404, detail="Compiled PDF not found")

    # Use 't' param in filename to bust cache if provided, else just standard compiled preview
    cache_suffix = f"_{t}" if t else ""
    preview_path = os.path.join(output_dir, f"compiled_preview_p{page_num}{cache_suffix}.png")

    if not os.path.exists(preview_path):
        with pdfplumber.open(pdf_path) as doc:
            if page_num >= len(doc.pages):
                raise HTTPException(status_code=404, detail="Page not found")

            page = doc.pages[page_num]
            im = page.to_image(resolution=DPI_FOR_PREVIEW)
            im.save(preview_path)

    return FileResponse(preview_path, media_type="image/png")


# ─────────────────────────────────────────────────────────────────
# Compile-and-download endpoints for edited LaTeX source
# ─────────────────────────────────────────────────────────────────

@router.post("/export/compile-pdf/{job_id}")
async def compile_and_download_pdf(job_id: str, request: Request):
    """
    Accept current edited LaTeX source, compile to PDF server-side,
    and return the compiled PDF as a download.
    """
    try:
        body = await request.json()
        latex_code = body.get("latex_code", "")

        if not latex_code.strip():
            raise HTTPException(status_code=400, detail="No LaTeX source provided")

        # Create a compile workspace
        compile_dir = os.path.join(str(OUTPUT_DIR), job_id, "compile_workspace")
        os.makedirs(compile_dir, exist_ok=True)

        # Copy images from the output directory if they exist
        images_src = os.path.join(str(OUTPUT_DIR), job_id, "images")
        images_dst = os.path.join(compile_dir, "images")
        if os.path.exists(images_src) and not os.path.exists(images_dst):
            shutil.copytree(images_src, images_dst)

        # Write the LaTeX source
        tex_path = os.path.join(compile_dir, "document.tex")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_code)

        # Determine compiler
        compiler = shutil.which(LATEX_COMPILER) or shutil.which("pdflatex")
        if not compiler:
            raise HTTPException(
                status_code=500,
                detail="No LaTeX compiler available on server. Install TeX Live or MiKTeX."
            )

        # Compile (two passes for cross-references)
        for _ in range(2):
            process = subprocess.run(
                [
                    compiler,
                    "-interaction=nonstopmode",
                    "-shell-escape",
                    "-output-directory", compile_dir,
                    tex_path,
                ],
                capture_output=True,
                text=True,
                timeout=LATEX_TIMEOUT,
                cwd=compile_dir,
            )

        pdf_path = os.path.join(compile_dir, "document.pdf")
        if not os.path.exists(pdf_path):
            # Extract error info from log
            log_text = process.stdout + process.stderr
            error_lines = [l for l in log_text.split("\n") if l.startswith("!")]
            error_msg = "; ".join(error_lines[:5]) if error_lines else "Compilation failed"
            raise HTTPException(status_code=500, detail=f"LaTeX compilation failed: {error_msg}")

        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=f"{job_id}_compiled.pdf",
        )

    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail=f"Compilation timed out after {LATEX_TIMEOUT}s")
    except Exception as e:
        logger.error(f"Compile-PDF failed for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Compilation failed: {str(e)}")


@router.post("/export/compile-docx/{job_id}")
async def compile_and_download_docx(job_id: str, request: Request):
    """
    Accept current edited LaTeX source, convert to DOCX via Pandoc,
    and return the DOCX as a download.
    Falls back to pdf2docx if Pandoc is not available.
    """
    try:
        body = await request.json()
        latex_code = body.get("latex_code", "")

        if not latex_code.strip():
            raise HTTPException(status_code=400, detail="No LaTeX source provided")

        compile_dir = os.path.join(str(OUTPUT_DIR), job_id, "compile_workspace")
        os.makedirs(compile_dir, exist_ok=True)

        tex_path = os.path.join(compile_dir, "document.tex")
        docx_path = os.path.join(compile_dir, "document.docx")

        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(latex_code)

        # Compile to PDF first, then use pdf2docx to ensure visual fidelity
        pdf_path = os.path.join(compile_dir, "document.pdf")
        if not os.path.exists(pdf_path):
            # Need to compile first
            compiler = shutil.which(LATEX_COMPILER) or shutil.which("pdflatex")
            if compiler:
                for _ in range(2):
                    subprocess.run(
                        [
                            compiler,
                            "-interaction=nonstopmode",
                            "-shell-escape",
                            "-output-directory", compile_dir,
                            tex_path,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=LATEX_TIMEOUT,
                        cwd=compile_dir,
                    )

        if os.path.exists(pdf_path):
            try:
                from pdf2docx import Converter
                cv = Converter(pdf_path)
                cv.convert(docx_path, start=0, end=None)
                cv.close()

                return FileResponse(
                    docx_path,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    filename=f"{job_id}_document.docx",
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"DOCX conversion failed: {str(e)}")

        raise HTTPException(
            status_code=500,
            detail="Could not generate DOCX. Neither Pandoc nor LaTeX compiler available."
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Compile-DOCX failed for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"DOCX conversion failed: {str(e)}")
