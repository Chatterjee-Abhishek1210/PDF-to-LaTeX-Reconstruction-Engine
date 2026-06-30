"""
Text Extractor — Extracts text with full formatting metadata from PDF pages.
Preserves font family, size, weight, style, color, underline, and position.
Per-span formatting is captured for mixed-style text blocks.
"""
import fitz
import re
import logging
from typing import List
from app.models.schemas import TextBlock, TextSpan, FontInfo

logger = logging.getLogger(__name__)


class TextExtractor:
    """
    Extracts text blocks from PDF pages with complete formatting information.
    Uses PyMuPDF's detailed text extraction with character-level data.
    """

    # Common font name mappings to LaTeX font families
    FONT_MAP = {
        "times": "serif",
        "arial": "sans-serif",
        "helvetica": "sans-serif",
        "courier": "monospace",
        "consolas": "monospace",
        "cambria": "serif",
        "calibri": "sans-serif",
        "georgia": "serif",
        "verdana": "sans-serif",
        "palatino": "serif",
        "garamond": "serif",
        "bookman": "serif",
        "cmr": "serif",       # Computer Modern Roman
        "cmss": "sans-serif", # Computer Modern Sans
        "cmtt": "monospace",  # Computer Modern Typewriter
    }

    def extract(self, page: fitz.Page, page_num: int) -> List[TextBlock]:
        """
        Extract all text blocks from a page with formatting metadata.
        Also gathers per-span data so the generator can reproduce
        mixed bold/italic/color within a single block.
        """
        blocks = []
        seen_spans = []

        # Use "dict" mode for detailed character-level extraction
        page_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)

        for block in page_dict.get("blocks", []):
            if block["type"] != 0:  # type 0 = text block
                continue

            block_text_parts = []
            block_fonts = []
            block_colors = []
            block_bbox = block["bbox"]
            all_spans: List[TextSpan] = []
            line_count = 0
            has_underline = False

            for line in block.get("lines", []):
                line_text = ""
                for span in line.get("spans", []):
                    text = span["text"]
                    if not text:
                        continue

                    span_bbox = span.get("bbox", block_bbox)

                    # Deduplicate spans that have the same text and very close coordinates
                    is_duplicate = False
                    for sx, sy, stext in seen_spans:
                        if stext.strip() == text.strip() and abs(sx - span_bbox[0]) < 1.0 and abs(sy - span_bbox[1]) < 1.0:
                            is_duplicate = True
                            break
                    if is_duplicate:
                        continue
                    seen_spans.append((span_bbox[0], span_bbox[1], text))

                    line_text += text
                    font_name = span.get("font", "")
                    font_size = span.get("size", 12.0)
                    font_flags = span.get("flags", 0)
                    color_int = span.get("color", 0)

                    # Parse font flags (PyMuPDF flags)
                    # bit 0 = superscript, bit 1 = italic, bit 2 = serif,
                    # bit 3 = monospace, bit 4 = bold
                    is_bold = bool(font_flags & (1 << 4))
                    is_italic = bool(font_flags & (1 << 1))

                    # Font name heuristics for bold/italic (much more reliable for many PDFs)
                    font_name_lower = font_name.lower()
                    if "bold" in font_name_lower or "black" in font_name_lower or "heavy" in font_name_lower or "semibold" in font_name_lower or "-bd" in font_name_lower:
                        is_bold = True
                    if "italic" in font_name_lower or "oblique" in font_name_lower or "-it" in font_name_lower:
                        is_italic = True

                    # Detect underline from font name heuristic
                    # PyMuPDF doesn't have a direct underline flag in font_flags,
                    # but we can detect it from annotations or the font name
                    is_underline = False

                    # Convert color integer to hex
                    r = (color_int >> 16) & 0xFF
                    g = (color_int >> 8) & 0xFF
                    b = color_int & 0xFF
                    color_hex = f"#{r:02x}{g:02x}{b:02x}"

                    family = self._map_font_family(font_name)

                    span_font = FontInfo(
                        family=family,
                        size=round(font_size, 1),
                        weight="bold" if is_bold else "normal",
                        style="italic" if is_italic else "normal",
                        color=color_hex,
                        name=font_name,
                        underline=is_underline,
                    )

                    all_spans.append(TextSpan(
                        text=text,
                        font=span_font,
                        x=span_bbox[0],
                        y=span_bbox[1],
                        base_y=span.get("origin", [span_bbox[0], span_bbox[1]])[1],
                        width=span_bbox[2] - span_bbox[0],
                        height=span_bbox[3] - span_bbox[1],
                    ))

                    block_fonts.append({
                        "name": font_name,
                        "size": font_size,
                        "bold": is_bold,
                        "italic": is_italic,
                        "underline": is_underline,
                    })
                    block_colors.append(color_hex)

                if line_text.strip():
                    block_text_parts.append(line_text)
                    line_count += 1

            full_text = "\n".join(block_text_parts)
            if not full_text.strip():
                continue

            # Determine dominant font for this block
            font_info = self._get_dominant_font(block_fonts, block_colors)

            # Detect underline from annotations on the page
            # (underlines in PDF are often drawn as line annotations or drawings)
            underline_detected = self._check_underline_drawings(
                page, block_bbox
            )
            if underline_detected:
                font_info.underline = True
                has_underline = True

            # Detect alignment
            page_width = page.rect.width
            alignment = self._detect_alignment(
                block_bbox, page_width, full_text
            )

            text_block = TextBlock(
                text=full_text,
                x=block_bbox[0],
                y=block_bbox[1],
                width=block_bbox[2] - block_bbox[0],
                height=block_bbox[3] - block_bbox[1],
                font=font_info,
                alignment=alignment,
                page=page_num,
                spans=all_spans,
                line_count=line_count,
            )

            blocks.append(text_block)

        # --- Post-processing: Deduplicate overlapping spans across the page ---
        if not blocks:
            return blocks

        # 1. Gather all spans with their parent block reference
        flat_spans = []
        for b_idx, b in enumerate(blocks):
            for s_idx, s in enumerate(b.spans):
                flat_spans.append({
                    "block_idx": b_idx,
                    "span_idx": s_idx,
                    "span": s,
                })

        # 2. Define priority key function
        def span_priority_key(item):
            s = item["span"]
            color_lower = s.font.color.lower()
            is_black = (color_lower in ("#000000", "#000"))
            
            is_gray = False
            if color_lower.startswith("#") and len(color_lower) in (4, 7):
                c = color_lower.lstrip("#")
                if len(c) == 3:
                    c = "".join(x*2 for x in c)
                try:
                    r = int(c[0:2], 16)
                    g = int(c[2:4], 16)
                    b = int(c[4:6], 16)
                    if abs(r - g) < 10 and abs(g - b) < 10 and r > 100 and r < 240:
                        is_gray = True
                except ValueError:
                    pass
            
            color_score = 2 if is_black else (0 if is_gray else 1)
            bold_score = 1 if s.font.weight == "bold" else 0
            
            return (len(s.text.strip()), color_score, bold_score, s.font.size)

        # Sort spans by priority descending
        flat_spans.sort(key=span_priority_key, reverse=True)

        accepted_spans = []
        discarded_span_keys = set()  # set of (block_idx, span_idx)

        for item in flat_spans:
            s = item["span"]
            b_idx = item["block_idx"]
            s_idx = item["span_idx"]
            
            # Check overlap with already accepted spans
            overlaps_any = False
            s_area = s.width * s.height
            if s_area > 0:
                for acc in accepted_spans:
                    acc_s = acc["span"]
                    acc_area = acc_s.width * acc_s.height
                    if acc_area > 0:
                        # Intersection bbox
                        x_left = max(s.x, acc_s.x)
                        y_top = max(s.y, acc_s.y)
                        x_right = min(s.x + s.width, acc_s.x + acc_s.width)
                        y_bottom = min(s.y + s.height, acc_s.y + acc_s.height)
                        
                        if x_right > x_left and y_bottom > y_top:
                            inter_area = (x_right - x_left) * (y_bottom - y_top)
                            min_area = min(s_area, acc_area)
                            # If overlap is greater than 50% of the smaller span's area
                            if inter_area / min_area > 0.5:
                                overlaps_any = True
                                break
            
            if overlaps_any:
                discarded_span_keys.add((b_idx, s_idx))
            else:
                accepted_spans.append(item)

        # 3. Rebuild blocks with accepted spans only
        deduped_blocks = []
        for b_idx, b in enumerate(blocks):
            keep_spans = []
            for s_idx, s in enumerate(b.spans):
                if (b_idx, s_idx) not in discarded_span_keys:
                    keep_spans.append(s)
            
            if keep_spans:
                b.spans = keep_spans
                # Rebuild block text from remaining spans, matching original layout structure
                line_parts = []
                current_line_y = None
                current_line_text = ""
                for s in keep_spans:
                    if current_line_y is None:
                        current_line_y = s.y
                        current_line_text = s.text
                    elif abs(s.y - current_line_y) < s.height * 0.5:
                        current_line_text += s.text
                    else:
                        if current_line_text.strip():
                            line_parts.append(current_line_text)
                        current_line_y = s.y
                        current_line_text = s.text
                if current_line_text.strip():
                    line_parts.append(current_line_text)
                
                b.text = "\n".join(line_parts)
                b.line_count = len(line_parts)
                deduped_blocks.append(b)

        return deduped_blocks

    def _check_underline_drawings(self, page: fitz.Page, block_bbox) -> bool:
        """
        Check if there are any horizontal lines (drawings) directly below
        a text block, which indicates underlined text.
        """
        x0, y0, x1, y1 = block_bbox
        block_bottom = y1
        block_left = x0
        block_right = x1

        try:
            drawings = page.get_drawings()
            for d in drawings:
                for item in d.get("items", []):
                    if item[0] == "l":  # line
                        p1 = item[1]
                        p2 = item[2]
                        # Check if this is a horizontal line near the bottom of the block
                        if abs(p1.y - p2.y) < 2:  # horizontal
                            line_y = p1.y
                            line_left = min(p1.x, p2.x)
                            line_right = max(p1.x, p2.x)
                            # Line should be near the bottom of the text block
                            # and span a significant portion of the block width
                            if (abs(line_y - block_bottom) < 5 and
                                line_left <= block_left + 5 and
                                line_right >= block_right - 5):
                                return True
                            # Also check if line is within the block vertically
                            if (y0 - 2 <= line_y <= y1 + 5 and
                                line_right - line_left > (block_right - block_left) * 0.5):
                                return True
        except Exception:
            pass

        return False

    def _get_dominant_font(self, fonts: list, colors: list) -> FontInfo:
        """
        Determine the dominant font info from a list of character fonts.
        """
        if not fonts:
            return FontInfo()

        # Use the most common font properties
        sizes = [f["size"] for f in fonts]
        avg_size = sum(sizes) / len(sizes) if sizes else 12.0

        # Most common bold/italic
        bold_count = sum(1 for f in fonts if f["bold"])
        italic_count = sum(1 for f in fonts if f["italic"])
        underline_count = sum(1 for f in fonts if f.get("underline", False))
        is_bold = bold_count > len(fonts) / 2
        is_italic = italic_count > len(fonts) / 2
        is_underline = underline_count > len(fonts) / 2

        # Most common font name
        font_name = fonts[0]["name"] if fonts else ""
        family = self._map_font_family(font_name)

        # Most common color
        color = colors[0] if colors else "#000000"
        if colors:
            color_counts = {}
            for c in colors:
                color_counts[c] = color_counts.get(c, 0) + 1
            color = max(color_counts, key=color_counts.get)

        return FontInfo(
            family=family,
            size=round(avg_size, 1),
            weight="bold" if is_bold else "normal",
            style="italic" if is_italic else "normal",
            color=color,
            name=font_name,
            underline=is_underline,
        )

    def _map_font_family(self, font_name: str) -> str:
        """
        Map PDF font name to a generic family (serif, sans-serif, monospace).
        """
        name_lower = font_name.lower()
        
        # Check direct keywords in the name first
        if "mono" in name_lower or "courier" in name_lower or "consolas" in name_lower or "typewriter" in name_lower:
            return "monospace"
        if "sans" in name_lower or "arial" in name_lower or "helvetica" in name_lower or "calibri" in name_lower or "verdana" in name_lower or "segoe" in name_lower or "roboto" in name_lower or "lato" in name_lower or "tahoma" in name_lower or "trebuchet" in name_lower or "gothic" in name_lower:
            return "sans-serif"
        if "times" in name_lower or "serif" in name_lower or "cambria" in name_lower or "georgia" in name_lower or "palatino" in name_lower or "garamond" in name_lower or "roman" in name_lower:
            return "serif"

        for key, family in self.FONT_MAP.items():
            if key in name_lower:
                return family

        # Default heuristics
        if "bold" in name_lower or "italic" in name_lower:
            clean = re.sub(r'[-_]?(bold|italic|regular|medium|light|book)', '', name_lower)
            for key, family in self.FONT_MAP.items():
                if key in clean:
                    return family

        return "serif"  # default

    def _detect_alignment(self, bbox, page_width, text) -> str:
        """
        Detect text alignment based on position relative to page.
        """
        x0, y0, x1, y1 = bbox
        block_width = x1 - x0
        center_x = (x0 + x1) / 2
        page_center = page_width / 2

        # If block is narrow and centered
        if abs(center_x - page_center) < 20 and block_width < page_width * 0.6:
            return "center"

        # If right-aligned
        if x1 > page_width * 0.85 and x0 > page_width * 0.4:
            return "right"

        # If text spans most of the page width, it's likely justified
        if block_width > page_width * 0.7:
            return "justify"

        return "left"
