# LairPages

Public static asset hosting for the Lair schedule application.

This repository hosts the static JSON schedules and the global manifest under the `schedules/` directory, served via GitHub Pages at:
`https://emmby.github.io/LairPages/schedules/`

---

## Schedule Conversion Pipeline

We use an automated agentic pipeline (powered by the Google Antigravity SDK and Gemini 3.5 Flash) to parse weekly camp schedule PDFs and structure them into the nested track JSON format required by the Lair app.

### Requirements & Setup

1. **Python 3**: Ensure you have Python 3 installed.
2. **Gemini API Key**: Obtain an API key from [Google AI Studio](https://aistudio.google.com/app/api-keys).
3. **Environment Setup**:
   Create a local virtual environment and install the dependencies:
   ```bash
   python3 -m venv .tmp/venv
   .tmp/venv/bin/pip install google-genai pydantic
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

---

## Integration with Dart Tests

The `LairPages` Dart test suite validates the integrity of all JSON schedule files in the repository.

When you run:
```bash
dart test
```

The test runner will:
1. Perform standard model parsing and timezone validations on all active JSON schedules.
2. Verify that `manifest.json` is structurally valid and all referenced files exist.

### Idempotency Rule
To protect manual tweaks, corrections, or custom formatting that developers may apply directly to generated JSON files over time, **the conversion script will never overwrite an existing JSON file**. If you need to regenerate a schedule from a modified PDF, delete the corresponding JSON file first.
