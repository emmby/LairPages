import argparse
import pypdf

def inspect_pdf(pdf_path: str, page_num: int = None):
    print(f"Reading PDF: {pdf_path}")
    reader = pypdf.PdfReader(pdf_path)
    print(f"Total pages: {len(reader.pages)}")
    
    if page_num is not None:
        if page_num < 1 or page_num > len(reader.pages):
            print(f"Error: Page number must be between 1 and {len(reader.pages)}")
            return
        pages = [page_num - 1]
    else:
        pages = list(range(len(reader.pages)))
        
    for p in pages:
        print(f"\n--- PAGE {p + 1} ---")
        text = reader.pages[p].extract_text()
        print(text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract and print text from a PDF file page-by-page.")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--page", type=int, help="Optional page number to inspect (1-indexed)")
    args = parser.parse_args()
    inspect_pdf(args.pdf_path, args.page)
