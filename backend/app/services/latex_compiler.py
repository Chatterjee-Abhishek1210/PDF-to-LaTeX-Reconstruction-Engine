"""
LaTeX Compiler — Compiles generated LaTeX source code to PDF.
"""
import os
import subprocess
import logging
import shutil
from pathlib import Path
from app.config import LATEX_COMPILER

logger = logging.getLogger(__name__)


class LaTeXCompiler:
    """
    Compiles LaTeX source code to PDF using xelatex or pdflatex.
    """

    def __init__(self, compiler: str = LATEX_COMPILER):
        self.compiler = compiler
        # Check if compiler is available
        self.available = shutil.which(compiler) is not None
        if not self.available:
            # Try fallback
            fallback = "pdflatex" if compiler != "pdflatex" else "xelatex"
            if shutil.which(fallback):
                self.compiler = fallback
                self.available = True
                logger.info(f"Using fallback compiler: {fallback}")
            else:
                logger.warning(
                    f"No LaTeX compiler found. Install TeX Live or MiKTeX."
                )

    def compile(self, tex_path: str, output_dir: str, timeout: int = 120) -> dict:
        """
        Compile a .tex file to PDF.

        Returns:
            dict with 'success', 'pdf_path', 'log', 'errors'
        """
        result = {
            "success": False,
            "pdf_path": None,
            "log": "",
            "errors": [],
        }

        if not self.available:
            result["errors"].append(
                "No LaTeX compiler available. Install TeX Live or MiKTeX."
            )
            return result

        tex_path = Path(tex_path)
        if not tex_path.exists():
            result["errors"].append(f"TeX file not found: {tex_path}")
            return result

        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Run compiler twice for cross-references
            for pass_num in range(2):
                process = subprocess.run(
                    [
                        self.compiler,
                        "-synctex=1",
                        "-interaction=nonstopmode",
                        "-shell-escape",
                        "-output-directory", str(output_dir),
                        str(tex_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    cwd=str(output_dir),  # cwd = output_dir so images/ path resolves
                )


                result["log"] = process.stdout + process.stderr

            # Check for output PDF
            pdf_name = tex_path.stem + ".pdf"
            pdf_path = output_dir / pdf_name

            if pdf_path.exists():
                result["success"] = True
                result["pdf_path"] = str(pdf_path)
                logger.info(f"Compilation successful: {pdf_path}")
            else:
                # Try finding it in the tex directory
                alt_pdf = tex_path.parent / pdf_name
                if alt_pdf.exists():
                    # Move to output dir
                    shutil.move(str(alt_pdf), str(pdf_path))
                    result["success"] = True
                    result["pdf_path"] = str(pdf_path)
                else:
                    result["errors"].append("PDF not generated")
                    # Parse log for errors
                    errors = self._parse_errors(result["log"])
                    result["errors"].extend(errors)

        except subprocess.TimeoutExpired:
            result["errors"].append(f"Compilation timed out after {timeout}s")
        except Exception as e:
            result["errors"].append(f"Compilation error: {str(e)}")

        return result

    def _parse_errors(self, log: str) -> list:
        """
        Parse LaTeX log for error messages.
        """
        errors = []
        for line in log.split("\n"):
            if line.startswith("!"):
                errors.append(line.strip())
            elif "Error" in line and "error" not in line.lower().split("no "):
                errors.append(line.strip())
        return errors[:10]  # Limit to first 10 errors
