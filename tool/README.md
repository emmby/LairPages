# Schedule Conversion & Diagnostic Tools

This directory contains the Python scripts and utilities used to parse weekly camp schedule PDFs and structure them into the nested track JSON format required by the Lair app.

---

## Schedule Conversion Pipeline

We use an automated agentic pipeline (powered by the Google Antigravity SDK and Gemini 3.5 Flash) to parse weekly camp schedule PDFs.

### Requirements & Setup

1. **Python 3**: Ensure you have Python 3 installed.
2. **Gemini API Key**: Obtain an API key from [Google AI Studio](https://aistudio.google.com/app/api-keys).
3. **Environment Setup**:
   Create a local virtual environment and install the dependencies:
   ```bash
   python3 -m venv .tmp/venv
   .tmp/venv/bin/pip install google-genai pydantic pypdf
   ```
4. **Export API Key**:
   ```bash
   export GEMINI_API_KEY="your-gemini-api-key"
   ```

### Running the Conversion Script

You can invoke the converter script manually on any weekly schedule PDF:

```bash
.tmp/venv/bin/python3 tool/convert_pdf.py schedules/2026/oski/week_04.pdf
```

#### Dry-run Mode
To test the extraction and verify the generated JSON structure without updating `manifest.json` or overwriting any original schedule files, append the `--dry-run` flag. This writes a `*_test.json` sibling file next to the PDF:

```bash
.tmp/venv/bin/python3 tool/convert_pdf.py schedules/2026/oski/week_04.pdf --dry-run
```

#### Idempotency Rule
To protect manual tweaks, corrections, or custom formatting that developers may apply directly to generated JSON files over time, **the conversion script will never overwrite an existing JSON file**. If you need to regenerate a schedule from a modified PDF, delete the corresponding JSON file first.

---

## Diagnostic & Debugging Tools

We provide standalone utility scripts under `tool/diagnostics/` to debug extraction accuracy and trace input texts:

### 1. PDF Text Inspection (`inspect_pdf_text.py`)
Extracts and prints the raw layout text from a PDF page-by-page. Helpful for verifying text coordinates or boundary boxes:
```bash
.tmp/venv/bin/python3 tool/diagnostics/inspect_pdf_text.py schedules/2026/oski/week_04.pdf --page 1
```

### 2. Direct Gemini Extraction Tester (`test_gemini_extraction.py`)
Performs an isolated event-extraction query on specific tracks using `gemini-3.5-flash` with the same temperature and response schemas as the main pipeline. Useful for testing prompt tuning or custom schemas:
```bash
.tmp/venv/bin/python3 tool/diagnostics/test_gemini_extraction.py schedules/2026/oski/week_04.pdf "Pool" "Lair Yoga"
```
