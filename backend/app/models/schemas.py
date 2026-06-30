"""
Pydantic schemas for request/response models.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class ConversionStatus(str, Enum):
    PENDING = "pending"
    PARSING = "parsing"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    COMPILING = "compiling"
    COMPARING = "comparing"
    COMPLETE = "complete"
    FAILED = "failed"


class FontInfo(BaseModel):
    family: str = "serif"
    size: float = 12.0
    weight: str = "normal"  # normal, bold
    style: str = "normal"  # normal, italic
    color: str = "#000000"
    name: str = ""  # original PDF font name
    underline: bool = False  # underlined text


class ColorInfo(BaseModel):
    hex: str = "#000000"
    r: int = 0
    g: int = 0
    b: int = 0


class TextSpan(BaseModel):
    """A single run of text with uniform formatting within a line."""
    text: str
    font: FontInfo
    x: float = 0
    y: float = 0
    base_y: float = 0  # Typography baseline Y coordinate
    width: float = 0
    height: float = 0


class TextBlock(BaseModel):
    text: str
    x: float
    y: float
    width: float
    height: float
    font: FontInfo
    alignment: str = "left"  # left, center, right, justify
    line_spacing: float = 1.0
    page: int = 0
    block_type: str = "paragraph"  # paragraph, heading, title, caption, footnote
    level: int = 0  # heading level (0 = not a heading)
    spans: List[TextSpan] = []  # per-span formatting within this block
    line_count: int = 1  # number of lines in this block


class ImageBlock(BaseModel):
    filename: str
    x: float
    y: float
    width: float
    height: float
    page: int = 0
    caption: Optional[str] = None
    original_width: int = 0
    original_height: int = 0


class TableCell(BaseModel):
    text: str
    row: int
    col: int
    rowspan: int = 1
    colspan: int = 1
    font: FontInfo = FontInfo()
    bg_color: Optional[str] = None
    border_top: bool = True
    border_bottom: bool = True
    border_left: bool = True
    border_right: bool = True
    alignment: str = "left"


class TableBlock(BaseModel):
    cells: List[TableCell]
    rows: int
    cols: int
    x: float
    y: float
    width: float
    height: float
    page: int = 0
    has_header: bool = True


class EquationBlock(BaseModel):
    latex: str
    x: float
    y: float
    width: float
    height: float
    page: int = 0
    inline: bool = False
    equation_number: Optional[str] = None


class DrawingElement(BaseModel):
    """Represents a drawn shape (rectangle, line, path) from the PDF."""
    draw_type: str = "rect"  # rect, line, path
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    page: int = 0
    fill_color: Optional[str] = None  # hex color or None
    stroke_color: Optional[str] = None  # hex color or None
    stroke_width: float = 0.5
    # For lines
    x2: float = 0
    y2: float = 0
    # Opacity (0.0–1.0)
    fill_opacity: float = 1.0
    stroke_opacity: float = 1.0
    # Pre-built TikZ path string for complex shapes (curves, etc.)
    path_data: str = ""


class PageLayout(BaseModel):
    width: float  # points
    height: float  # points
    margin_top: float = 72
    margin_bottom: float = 72
    margin_left: float = 72
    margin_right: float = 72
    columns: int = 1
    column_gap: float = 20
    bg_color: str = "#FFFFFF"
    has_header: bool = False
    has_footer: bool = False
    header_text: str = ""
    footer_text: str = ""
    page_num: int = 0
    drawings: List[DrawingElement] = []  # drawn shapes on this page


class DocumentStructure(BaseModel):
    pages: int
    page_layouts: List[PageLayout]
    text_blocks: List[TextBlock]
    image_blocks: List[ImageBlock]
    table_blocks: List[TableBlock]
    equation_blocks: List[EquationBlock]
    title: Optional[str] = None
    author: Optional[str] = None
    metadata: Dict[str, Any] = {}


class ConversionJob(BaseModel):
    job_id: str
    status: ConversionStatus = ConversionStatus.PENDING
    progress: float = 0.0
    message: str = ""
    latex_code: Optional[str] = None
    ssim_score: Optional[float] = None
    original_pdf_path: Optional[str] = None
    generated_pdf_path: Optional[str] = None
    output_dir: Optional[str] = None


class ConversionResponse(BaseModel):
    job_id: str
    status: str
    message: str


class FidelityReport(BaseModel):
    ssim_score: float
    pixel_match_percentage: float
    structural_accuracy: float
    color_accuracy: float
    details: Dict[str, Any] = {}
