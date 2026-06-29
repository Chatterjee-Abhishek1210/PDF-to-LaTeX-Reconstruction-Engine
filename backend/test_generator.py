import os
import sys
import asyncio

# Setup path so we can import from app
sys.path.append('c:\\Users\\ASUS\\OneDrive\\Desktop\\pdf2latx\\backend')

from app.services.pdf_parser import PDFParser
from app.services.latex_generator import LaTeXGenerator
from app.models.schemas import DocumentStructure, PageLayout, TextBlock, TextSpan, FontInfo

async def main():
    try:
        structure = DocumentStructure(
            pages=1,
            page_layouts=[PageLayout(width=612, height=792, bg_color="#ffffff", drawings=[])],
            text_blocks=[
                TextBlock(
                    id="t1",
                    page=0,
                    x=50,
                    y=50,
                    width=100,
                    height=20,
                    text="Hello World",
                    line_count=1,
                    font=FontInfo(family="sans-serif", size=12, color="#000000", weight="normal", style="normal", underline=False),
                    spans=[]
                )
            ],
            image_blocks=[],
            table_blocks=[],
            equation_blocks=[]
        )
        
        generator = LaTeXGenerator()
        latex = generator.generate(structure)
        
        print("GENERATE SUCCESS!")
        print("Length:", len(latex))
        print("End of string:", repr(latex[-50:]))
    except Exception as e:
        print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
