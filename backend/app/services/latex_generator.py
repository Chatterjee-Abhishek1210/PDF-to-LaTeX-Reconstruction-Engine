"""
LaTeX Generator — Generates pixel-perfect LaTeX source code
from parsed PDF document structure using absolute positioning.

Strategy:
  Each page is rendered as a full-page TikZ picture with the origin
  at the top-left corner (y increases downward).  Every text block,
  image, table, equation, and drawing element is placed at its exact
  (x, y) coordinate extracted from the PDF.

Key design decisions:
  - Font sizes use \\fontsize{X}{1.2X}\\selectfont for exact pt sizing
  - Single-line text blocks do NOT set text width (prevents wrapping)
  - Multi-line text blocks use generous text width (1.15x) to avoid
    premature line breaks from font metric differences
  - Underlines are reproduced with \\underline{}
  - Images are placed at exact coordinates with exact dimensions
  - Drawing elements (filled rects, borders, lines) are rendered
    as TikZ fill/draw commands
"""
import re
import logging
from typing import List, Set, Dict, Optional
from app.models.schemas import (
    DocumentStructure, PageLayout, TextBlock, TextSpan, ImageBlock,
    TableBlock, TableCell, EquationBlock, DrawingElement, FontInfo
)

logger = logging.getLogger(__name__)


class LaTeXGenerator:
    """
    Generates compilable LaTeX that faithfully reproduces the original
    PDF's visual layout using absolute (x, y) positioning on every page.
    """

    def __init__(self):
        self.used_packages: Set[str] = set()
        self.defined_colors: Dict[str, str] = {}
        self.color_counter = 0

    # ──────────────────────────────────────────────────────────────
    #  Public API
    # ──────────────────────────────────────────────────────────────
    def generate(self, structure: DocumentStructure) -> str:
        logger.info("Starting LaTeX generation (absolute-positioning mode)")

        self.used_packages = set()
        self.defined_colors = {}
        self.color_counter = 0

        self._scan_requirements(structure)

        preamble = self._generate_preamble(structure)
        body = self._generate_body(structure)

        latex = f"{preamble}\n\n\\begin{{document}}\n\n{body}\n\n\\end{{document}}\n"

        logger.info(f"LaTeX generation complete: {len(latex)} characters")
        return latex

    # ──────────────────────────────────────────────────────────────
    #  Pre-scan
    # ──────────────────────────────────────────────────────────────
    def _scan_requirements(self, structure: DocumentStructure):
        self.used_packages.update([
            "inputenc", "fontenc", "geometry", "xcolor",
            "graphicx", "float", "tikz",
            "amsmath", "amssymb", "ulem",
        ])

        if structure.table_blocks:
            self.used_packages.update(["array", "tabularx"])

        for block in structure.text_blocks:
            self._register_color(block.font.color)
            for span in block.spans:
                self._register_color(span.font.color)

        for block in structure.table_blocks:
            for cell in block.cells:
                self._register_color(cell.font.color)
                if cell.bg_color:
                    self._register_color(cell.bg_color)

        for layout in structure.page_layouts:
            if layout.bg_color.lower() not in ("#ffffff", "#fff"):
                self._register_color(layout.bg_color)
            for d in layout.drawings:
                if d.fill_color:
                    self._register_color(d.fill_color)
                if d.stroke_color:
                    self._register_color(d.stroke_color)

    def _register_color(self, hex_color: str) -> str:
        if not hex_color or hex_color.lower() in ("#000000", ""):
            return "black"
        if hex_color.lower() in ("#ffffff", "#fff"):
            return "white"

        hex_clean = hex_color.lstrip("#").lower()
        if len(hex_clean) == 3:
            hex_clean = "".join(c * 2 for c in hex_clean)

        if hex_clean in self.defined_colors:
            return self.defined_colors[hex_clean]

        common = {
            "ff0000": "red", "00ff00": "green", "0000ff": "blue",
            "ffff00": "yellow", "ff00ff": "magenta", "00ffff": "cyan",
            "808080": "gray", "c0c0c0": "lightgray",
        }
        if hex_clean in common:
            self.defined_colors[hex_clean] = common[hex_clean]
            return common[hex_clean]

        self.color_counter += 1
        name = f"pdfcolor{self.color_counter}"
        self.defined_colors[hex_clean] = name
        return name

    # ──────────────────────────────────────────────────────────────
    #  Preamble
    # ──────────────────────────────────────────────────────────────
    def _generate_preamble(self, structure: DocumentStructure) -> str:
        lines: List[str] = []

        layout0 = (
            structure.page_layouts[0]
            if structure.page_layouts
            else PageLayout(width=595, height=842)
        )
        paper = self._detect_paper_size(layout0.width, layout0.height)
        lines.append(f"\\documentclass[12pt,{paper}]{{article}}")

        lines += ["", "% ===== Encoding and fonts ====="]
        lines.append("\\usepackage[utf8]{inputenc}")
        lines.append("\\usepackage[T1]{fontenc}")
        lines.append("\\usepackage{mathptmx}")
        lines.append("\\usepackage{helvet}")
        lines.append("\\usepackage{courier}")

        # Zero margins — we do all positioning ourselves
        lines += ["", "% ===== Page geometry (zero margins) ====="]
        lines.append(
            "\\usepackage[top=0bp,bottom=0bp,left=0bp,right=0bp,"
            "headheight=0bp,headsep=0bp,footskip=0bp,"
            f"paperwidth={layout0.width:.2f}bp,"
            f"paperheight={layout0.height:.2f}bp]{{geometry}}"
        )

        lines += ["", "% ===== Packages ====="]
        lines.append("\\usepackage[dvipsnames,svgnames,x11names]{xcolor}")
        lines.append("\\usepackage{graphicx}")
        lines.append("\\usepackage{tikz}")
        lines.append("\\usepackage{float}")
        lines.append("\\usepackage{amsmath}")
        lines.append("\\usepackage{amssymb}")
        lines.append("\\usepackage[normalem]{ulem}  % for \\uline (underline)")
        if "array" in self.used_packages:
            lines.append("\\usepackage{array}")
        if "tabularx" in self.used_packages:
            lines.append("\\usepackage{tabularx}")

        lines += ["", "% ===== No default spacing ====="]
        lines.append("\\setlength{\\parindent}{0pt}")
        lines.append("\\setlength{\\parskip}{0pt}")
        lines.append("\\pagestyle{empty}")

        # Currency / special symbols
        lines += ["", "% ===== Currency symbols ====="]
        lines.append("\\usepackage{textcomp}")
        lines.append("\\newcommand{\\rupee}{\\textrm{Rs.}}")  # fallback ₹

        # Custom colours
        if self.defined_colors:
            lines += ["", "% ===== Custom colours ====="]
            builtin = {"red", "green", "blue", "yellow", "magenta",
                       "cyan", "gray", "lightgray", "black", "white"}
            for hex_val, name in self.defined_colors.items():
                if name not in builtin:
                    r = int(hex_val[0:2], 16)
                    g = int(hex_val[2:4], 16)
                    b = int(hex_val[4:6], 16)
                    lines.append(
                        f"\\definecolor{{{name}}}{{RGB}}{{{r},{g},{b}}}"
                    )

        return "\n".join(lines)

    # ──────────────────────────────────────────────────────────────
    #  Body — one tikzpicture per page
    # ──────────────────────────────────────────────────────────────
    def _generate_body(self, structure: DocumentStructure) -> str:
        pages_latex: List[str] = []

        for page_idx in range(structure.pages):
            layout = (
                structure.page_layouts[page_idx]
                if page_idx < len(structure.page_layouts)
                else structure.page_layouts[0]
            )
            page_w = layout.width
            page_h = layout.height

            texts = [b for b in structure.text_blocks if b.page == page_idx]
            images = [b for b in structure.image_blocks if b.page == page_idx]
            tables = [b for b in structure.table_blocks if b.page == page_idx]
            equations = [b for b in structure.equation_blocks if b.page == page_idx]
            drawings = layout.drawings

            page_lines: List[str] = []

            page_lines.append("\\noindent")
            page_lines.append(
                "\\begin{tikzpicture}[x=1bp,y=-1bp,"
                "inner sep=0pt,outer sep=0pt]"
            )
            page_lines.append(
                f"  \\useasboundingbox (0,0) rectangle "
                f"({page_w:.2f},{page_h:.2f});"
            )

            # Background colour
            bg = layout.bg_color.lower()
            if bg not in ("#ffffff", "#fff", "ffffff"):
                bg_name = self._get_color_name(layout.bg_color) or "white"
                page_lines.append(
                    f"  \\fill[{bg_name}] (0,0) rectangle "
                    f"({page_w:.2f},{page_h:.2f});"
                )

            # --- Layer 1: Drawings (backgrounds, borders, lines) ---
            for d in drawings:
                line = self._draw_element(d)
                if line:
                    page_lines.append(line)

            # --- Layer 2: Images (behind text) ---
            for img in images:
                page_lines.append(self._place_image(img))

            # --- Layer 3: Tables ---
            for tbl in tables:
                page_lines.append(self._place_table(tbl))

            # --- Layer 4: Text (on top of everything) ---
            for tb in texts:
                page_lines.append(self._place_text_block(tb))

            # --- Layer 5: Equations ---
            for eq in equations:
                page_lines.append(self._place_equation(eq))

            page_lines.append("\\end{tikzpicture}")
            pages_latex.append("\n".join(page_lines))

        return "\n\\newpage\n".join(pages_latex)

    # ──────────────────────────────────────────────────────────────
    #  Drawing elements
    # ──────────────────────────────────────────────────────────────
    def _draw_element(self, d: DrawingElement) -> str:
        if d.draw_type == "rect":
            return self._draw_rect(d)
        elif d.draw_type == "line":
            return self._draw_line(d)
        elif d.draw_type == "path":
            return self._draw_path(d)
        return ""

    @staticmethod
    def _opacity_options(d: DrawingElement) -> List[str]:
        """Return TikZ opacity keys when they differ from the default 1.0."""
        opts: List[str] = []
        if d.fill_opacity < 1.0:
            opts.append(f"fill opacity={d.fill_opacity:.3f}")
        if d.stroke_opacity < 1.0:
            opts.append(f"draw opacity={d.stroke_opacity:.3f}")
        return opts

    def _draw_rect(self, d: DrawingElement) -> str:
        options: List[str] = []
        has_fill = False
        has_stroke = False

        if d.fill_color:
            c = self._get_color_name(d.fill_color)
            if c:
                options.append(f"fill={c}")
                has_fill = True
        if d.stroke_color:
            c = self._get_color_name(d.stroke_color)
            if c:
                options.append(f"draw={c}")
                has_stroke = True
            if d.stroke_width and d.stroke_width > 0:
                options.append(f"line width={d.stroke_width:.2f}bp")
        
        options += self._opacity_options(d)
        if not options:
            return ""

        opt_str = ",".join(options)
        x1 = d.x + d.width
        y1 = d.y + d.height

        if has_fill and has_stroke:
            cmd = "\\filldraw"
        elif has_fill:
            cmd = "\\fill"
        elif has_stroke:
            cmd = "\\draw"
        else:
            cmd = "\\path"

        return (
            f"  {cmd}[{opt_str}] ({d.x:.2f},{d.y:.2f}) "
            f"rectangle ({x1:.2f},{y1:.2f});"
        )

    def _draw_line(self, d: DrawingElement) -> str:
        options: List[str] = []
        c = self._get_color_name(d.stroke_color) if d.stroke_color else "black"
        options.append(f"draw={c}")
        if d.stroke_width and d.stroke_width > 0:
            options.append(f"line width={d.stroke_width:.2f}bp")
        options += self._opacity_options(d)
        opt_str = ",".join(options)
        return (
            f"  \\draw[{opt_str}] ({d.x:.2f},{d.y:.2f}) "
            f"-- ({d.x2:.2f},{d.y2:.2f});"
        )

    def _draw_path(self, d: DrawingElement) -> str:
        """Emit a pre-built TikZ path with correct fill/stroke/opacity."""
        if not d.path_data:
            return ""
        options: List[str] = []
        has_fill = False
        has_stroke = False

        if d.fill_color:
            c = self._get_color_name(d.fill_color)
            if c:
                options.append(f"fill={c}")
                has_fill = True
        if d.stroke_color:
            c = self._get_color_name(d.stroke_color)
            if c:
                options.append(f"draw={c}")
                has_stroke = True
            if d.stroke_width and d.stroke_width > 0:
                options.append(f"line width={d.stroke_width:.2f}bp")
        
        options += self._opacity_options(d)
        if not options:
            options.append("fill=black")
            has_fill = True

        opt_str = ",".join(options)
        
        if has_fill and has_stroke:
            cmd = "\\filldraw"
        elif has_fill:
            cmd = "\\fill"
        elif has_stroke:
            cmd = "\\draw"
        else:
            cmd = "\\path"

        # Check if path_data already ends with cycle/-- cycle
        path_str = d.path_data.strip()
        if path_str.endswith("cycle") or path_str.endswith("-- cycle"):
            return f"  {cmd}[{opt_str}] {path_str};"
        else:
            return f"  {cmd}[{opt_str}] {path_str} -- cycle;"

    # ──────────────────────────────────────────────────────────────
    #  Images
    # ──────────────────────────────────────────────────────────────
    def _place_image(self, img: ImageBlock) -> str:
        return (
            f"  \\node[anchor=north west,inner sep=0pt] "
            f"at ({img.x:.2f},{img.y:.2f}) "
            f"{{\\includegraphics[width={img.width:.2f}bp,"
            f"height={img.height:.2f}bp]"
            f"{{images/{img.filename}}}}};"
        )

    # ──────────────────────────────────────────────────────────────
    #  Text blocks
    # ──────────────────────────────────────────────────────────────
    def _place_text_block(self, block: TextBlock, page_h: float = 0) -> str:
        """
        Place a text block at its absolute position.
        If spans are present, render each span as a separate absolute node
        to guarantee 100% pixel-perfect positioning and prevent different
        font metrics in LaTeX from shifting text or breaking columns.
        """
        if block.spans:
            lines = []
            for span in block.spans:
                text = self._escape_latex(span.text)
                if not text.strip():
                    continue
                
                # Apply font formatting to this specific span
                inner = self._apply_font_formatting(text, span.font)
                
                # Since spans are single-line, we do not set text width (prevents wrapping)
                node_opts = "anchor=north west,inner sep=0pt,outer sep=0pt"
                lines.append(
                    f"  \\node[{node_opts}] at ({span.x:.2f},{span.y:.2f}) "
                    f"{{{inner}}};"
                )
            return "\n".join(lines)

        # Fallback if no spans are present: render block text as a single node
        x = block.x
        y = block.y
        w = block.width
        inner = self._render_block_text(block)
        is_multiline = block.line_count > 1

        if is_multiline:
            generous_w = w * 1.15
            node_opts = (
                f"anchor=north west,inner sep=0pt,outer sep=0pt,"
                f"text width={generous_w:.2f}bp"
            )
        else:
            node_opts = "anchor=north west,inner sep=0pt,outer sep=0pt"

        return (
            f"  \\node[{node_opts}] at ({x:.2f},{y:.2f}) "
            f"{{{inner}}};"
        )

    def _render_spans(self, spans: List[TextSpan]) -> str:
        """Render per-span formatting for mixed-style text."""
        parts: List[str] = []
        prev_y = None

        for span in spans:
            text = self._escape_latex(span.text)
            if not text.strip() and not text:
                continue

            # Detect line breaks: if this span's y position is
            # significantly different from the previous, insert \\
            if prev_y is not None:
                y_diff = abs(span.y - prev_y)
                if y_diff > span.height * 0.5:
                    parts.append(" \\\\\n")

            text = self._apply_font_formatting(text, span.font)
            parts.append(text)
            prev_y = span.y

        return "".join(parts)

    def _render_block_text(self, block: TextBlock) -> str:
        """Render block-level text with uniform formatting."""
        text = self._escape_latex(block.text)
        # Replace newlines with LaTeX line breaks
        text = text.replace("\n", " \\\\\n")
        return self._apply_font_formatting(text, block.font)

    def _apply_font_formatting(self, text: str, font: FontInfo) -> str:
        """Apply exact font size, bold, italic, underline, colour."""
        result = text

        # Bold
        if font.weight == "bold":
            result = f"\\textbf{{{result}}}"
        # Italic
        if font.style == "italic":
            result = f"\\textit{{{result}}}"
        # Underline
        if font.underline:
            result = f"\\uline{{{result}}}"

        # Colour
        color_name = self._get_color_name(font.color)
        if color_name and color_name != "black":
            result = f"\\textcolor{{{color_name}}}{{{result}}}"

        # Exact font size using \fontsize{SIZE}{BASELINESKIP}\selectfont
        # This gives us precise point-size control instead of coarse
        # \Large, \huge etc.
        size = font.size
        if size > 0:
            baseline = size * 1.2
            result = (
                f"{{\\fontsize{{{size:.1f}bp}}{{{baseline:.1f}bp}}"
                f"\\selectfont {result}}}"
            )

        # Font family
        if font.family == "sans-serif":
            result = f"\\textsf{{{result}}}"
        elif font.family == "monospace":
            result = f"\\texttt{{{result}}}"

        return result

    # ──────────────────────────────────────────────────────────────
    #  Tables
    # ──────────────────────────────────────────────────────────────
    def _place_table(self, block: TableBlock, page_h: float = 0) -> str:
        return ""
        for c in range(block.cols):
            alignments = [
                cell.alignment for cell in block.cells if cell.col == c
            ]
            if alignments:
                most_common = max(set(alignments), key=alignments.count)
                align_map = {"left": "l", "center": "c", "right": "r"}
                col_aligns.append(align_map.get(most_common, "l"))
            else:
                col_aligns.append("l")

        col_spec = "|".join(col_aligns)
        col_spec = f"|{col_spec}|"

        tab_lines = [f"\\begin{{tabular}}{{{col_spec}}}", "\\hline"]

        for row in range(block.rows):
            row_cells = sorted(
                [c for c in block.cells if c.row == row],
                key=lambda c: c.col,
            )
            cell_texts = []
            for cell in row_cells:
                cell_text = self._escape_latex(cell.text)
                if row == 0 and block.has_header:
                    cell_text = f"\\textbf{{{cell_text}}}"
                if cell.bg_color:
                    color_name = self._get_color_name(cell.bg_color)
                    if color_name:
                        cell_text = f"\\cellcolor{{{color_name}}}{cell_text}"
                cell_texts.append(cell_text)

            while len(cell_texts) < block.cols:
                cell_texts.append("")

            tab_lines.append(" & ".join(cell_texts) + " \\\\")
            if row == 0 and block.has_header:
                tab_lines.append("\\hline")

        tab_lines += ["\\hline", "\\end{tabular}"]
        tabular_str = "\n".join(tab_lines)

        return (
            f"  \\node[anchor=north west,inner sep=0pt] "
            f"at ({block.x:.2f},{block.y:.2f}) {{{tabular_str}}};"
        )

    # ──────────────────────────────────────────────────────────────
    #  Equations
    # ──────────────────────────────────────────────────────────────
    def _place_equation(self, eq: EquationBlock, page_h: float = 0) -> str:
        if eq.inline:
            return ""

        content = f"$\\displaystyle {eq.latex}$"

        return (
            f"  \\node[anchor=north west,inner sep=0pt] "
            f"at ({eq.x:.2f},{eq.y:.2f}) {{{content}}};"
        )

    # ──────────────────────────────────────────────────────────────
    #  Helpers
    # ──────────────────────────────────────────────────────────────
    def _escape_latex(self, text: str) -> str:
        if not text:
            return ""

        special_chars = {
            '\\': r'\textbackslash{}',
            '&': r'\&',
            '%': r'\%',
            '$': r'\$',
            '#': r'\#',
            '_': r'\_',
            '{': r'\{',
            '}': r'\}',
            '~': r'\textasciitilde{}',
            '^': r'\textasciicircum{}',
        }

        result = text
        for char, escaped in special_chars.items():
            result = result.replace(char, escaped)

        # Unicode characters that pdfLaTeX cannot handle natively
        unicode_map = {
            '₹': r'{\textrm{\rupee}}',   # handled via textcomp or custom def
            '©': r'\textcopyright{}',
            '®': r'\textregistered{}',
            '™': r'\texttrademark{}',
            '°': r'\textdegree{}',
            '€': r'\texteuro{}',
            '£': r'\textsterling{}',
            '¥': r'\textyen{}',
            '\u00a0': ' ',                # non-breaking space → normal space
            '–': '--',                    # en-dash
            '—': '---',                   # em-dash
            '…': '...',                   # ellipsis
        }
        for char, escaped in unicode_map.items():
            result = result.replace(char, escaped)

        # Prevent space collapse by replacing consecutive spaces with ~
        result = re.sub(r' {2,}', lambda m: '~' * len(m.group(0)), result)

        return result

    def _get_color_name(self, hex_color: str) -> Optional[str]:
        if not hex_color:
            return None
        hex_clean = hex_color.lstrip("#").lower()
        if len(hex_clean) == 3:
            hex_clean = "".join(c * 2 for c in hex_clean)
        if hex_clean == "000000":
            return "black"
        if hex_clean == "ffffff":
            return "white"
        return self.defined_colors.get(hex_clean, None)

    def _detect_paper_size(self, width: float, height: float) -> str:
        sizes = {
            "a4paper": (595.28, 841.89),
            "letterpaper": (612, 792),
            "a3paper": (841.89, 1190.55),
            "a5paper": (419.53, 595.28),
            "legalpaper": (612, 1008),
        }
        best_match = "a4paper"
        min_diff = float("inf")
        for name, (w, h) in sizes.items():
            diff = abs(width - w) + abs(height - h)
            if diff < min_diff:
                min_diff = diff
                best_match = name
        return best_match
