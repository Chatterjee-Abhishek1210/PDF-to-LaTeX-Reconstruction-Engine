import sys
import asyncio
sys.path.append('c:\\Users\\ASUS\\OneDrive\\Desktop\\pdf2latx\\backend')
from app.services.pdf_parser import PDFParser
from app.services.latex_generator import LaTeXGenerator
import logging
logging.basicConfig(level=logging.INFO)

async def main():
    pdf_path = r'C:\Users\ASUS\OneDrive\Desktop\pdf2latx\backend\uploads\baf19121-d92\ABHISHEK_CHATTERJEE_RESUME.pdf'
    output_dir = r'C:\Users\ASUS\OneDrive\Desktop\pdf2latx\backend\temp'
    
    parser = PDFParser(pdf_path, output_dir)
    def cb(p, m): pass
    structure = parser.parse(cb)
    
    generator = LaTeXGenerator()
    latex = generator.generate(structure)
    print("GENERATE SUCCESS!")
    print("Length:", len(latex))
    print("Ends with end document?", latex.strip().endswith('\\end{document}'))
    
    with open('test_out.tex', 'w', encoding='utf-8') as f:
        f.write(latex)

if __name__ == "__main__":
    asyncio.run(main())
