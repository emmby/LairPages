# LairPages

Public static asset hosting and automated ingestion pipeline for the Lair schedule application.

This repository hosts the static JSON schedules and the global manifest under the `schedules/` directory, served via GitHub Pages at:
`https://emmby.github.io/LairPages/schedules/`

---

## Automated PDF Ingestion Workflow

We have implemented an automated end-to-end ingestion pipeline to allow non-technical staff (such as camp managers) to upload new schedules.

```
[Camp Staff] 
    │ (Drops PDF in Google Drive Folder)
    ▼
[Google Drive Inbox]
    │ (Daily Google Apps Script Watcher runs)
    ▼
[GitHub Inbox] (schedules/inbox/filename.pdf)
    │ (GitHub Action triggers)
    ▼
[Isolated Branch Ingestion & Tests]
    ├── Runs Gemini-based Parser (moves PDF to camp folder & generates JSON)
    ├── Runs Vitest validation suite
    ▼
[PR Creation & Deployment]
    ├── Succeeded: Creates PR, auto-merges, deletes branch -> Deploys to Pages
    └── Failed: Creates open [FAILED] PR for manual review and debugging
```

### How to Set Up Ingestion

#### 1. Google Apps Script Setup
1. Go to [Google Apps Script](https://script.google.com).
2. Create a new project named **Lair Schedule Ingest Watcher**.
3. Copy the script from [tool/google-apps-script.js](file:///Users/mike/.gemini/antigravity/worktrees/LairPages/automate-pdf-ingestion-workflow/tool/google-apps-script.js) and paste it into the editor (replacing all default code).
4. Click the gear icon (**Project Settings**) on the left sidebar.
5. Under **Script Properties**, add the following settings:
   - `GITHUB_PAT`: A GitHub Personal Access Token (classic) with `repo` scope to authorize commits.
   - `INBOX_FOLDER_ID`: The Folder ID of your Google Drive schedule upload folder.
   - `PROCESSED_FOLDER_ID` (Optional): The Folder ID where processed PDFs will be moved (if omitted, it creates a `Processed` subfolder automatically inside your Inbox folder).
6. Click the clock icon (**Triggers**) on the left sidebar.
7. Click **+ Add Trigger**:
   - Choose function to run: `checkAndUploadSchedules`
   - Select event source: `Time-driven`
   - Select type of trigger: `Day timer` (recommend daily run, e.g., 6:00 AM - 7:00 AM)
   - Save and authorize permissions.

#### 2. GitHub Secrets Setup
Ensure the following Repository Secrets are added in your GitHub repository settings under **Settings -> Secrets and variables -> Actions**:
- `GEMINI_API_KEY`: Your Gemini API key from Google AI Studio.
- `LAIR_REPO_PAT`: A GitHub Personal Access Token with write access to `emmby/LairPages` and read access to `emmby/Lair` (so the validation check can load maps).

---

## Manual Execution (CLI)

If you are a developer with local repository access, you can run the parsing pipeline manually.

### Setup
1. Copy the `.env` configuration with `GEMINI_API_KEY`.
2. Run `npm install` to install dependencies.

### Command
```bash
# General usage
npx tsx src/index.ts schedules/2026/oski/week_03.pdf

# Force visual OCR run without Step 0 cache
npx tsx src/index.ts schedules/2026/oski/week_03.pdf --no-cache
```

For more details on manual conversion parameters, see the [Tool README](file:///Users/mike/.gemini/antigravity/worktrees/LairPages/automate-pdf-ingestion-workflow/tool/README.md).

---

## Testing & Validation

We enforce strict schema and cross-camp location link checks on all JSON files before merging:
```bash
# Run the local Vitest suite
npm test
```
The test suite validates:
1. All JSON files follow the required schema boundaries and offset timestamps.
2. Every `maplocation://` markdown link maps to a valid location ID defined in the sibling `Lair/assets/maps/locations_{camp}.json` files.
