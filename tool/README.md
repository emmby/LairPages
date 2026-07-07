# Schedule Conversion & Processing Pipeline

This directory contains documentation for the TypeScript Genkit pipeline used to parse weekly camp schedule PDFs and structure them into the nested track JSON format required by the Lair app.

---

## TypeScript Genkit Schedule Pipeline

We use an automated multi-stage pipeline powered by Firebase Genkit and Gemini 3.5 Flash to transcribe and structure the schedules.

### Requirements & Setup

1. **Node.js**: Ensure you have Node.js 18+ installed.
2. **Gemini API Key**: Obtain an API key from Google AI Studio.
3. **Environment Setup**:
   Add your API key to `.env` in the project root:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   ```
4. **Install Dependencies**:
   ```bash
   npm install
   ```

### Running the Pipeline

You can invoke the pipeline CLI on any weekly schedule PDF:

```bash
npx tsx src/index.ts schedules/2026/oski/week_03.pdf
```

#### Cache Mode (Default)
By default, the pipeline checks for a cached Step 0 visual transcription under `.tmp/batch_step0/` or `.tmp/` before querying Gemini OCR for images. This saves token usage and run time.

#### OCR Run Mode (No Cache)
To force a full transcription run directly from the PDF pages (running visual OCR fresh on the page images), pass the `--no-cache` flag:

```bash
npx tsx src/index.ts schedules/2026/oski/week_03.pdf --no-cache
```

#### Automated Validation
After generating the schedule JSON, the pipeline runs an automated **LLM-as-judge audit** (Step 5) checking completeness and correctness. If it passes, it updates `schedules/manifest.json` with the MD5 version hash.

To run the local unit and integration tests:
```bash
npm test
```
