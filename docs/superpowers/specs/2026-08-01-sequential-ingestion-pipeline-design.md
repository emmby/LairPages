# Sequential PDF Ingestion Pipeline Design Spec

## Overview
The LairPages ingestion pipeline processes schedule PDFs dropped into `schedules/inbox/` and creates Pull Requests for each schedule. Previously, when multiple PDFs were present in a single batch, concurrent PRs updated `schedules/manifest.json` from the same base branch state (`main`), resulting in merge conflicts in `manifest.json` for subsequent PRs.

This design updates `.github/workflows/ingest-pdf.yml` to process PDFs sequentially with an automated merge-wait loop and non-blocking failure recovery, while updating `.github/workflows/validate.yml` concurrency rules.

## Requirements & Constraints
1. **Multi-File Batch Support**: The workflow must cleanly process multiple PDFs in `schedules/inbox/` in a single run without triggering git merge conflicts in `schedules/manifest.json`.
2. **Individual PRs**: Each PDF must still be processed in its own dedicated Pull Request.
3. **Non-Blocking Recovery**: If a PDF fails parsing or unit/validation tests, its PR will be created as `[FAILED]` (without auto-merge), and the workflow will immediately proceed to process the remaining PDFs without stalling or failing the entire batch.
4. **Clean State Isolation**: At the start of each file iteration, `rm -rf .tmp` must be executed to ensure no transient state (like `.tmp/processpdf_lastrun.json` or `.tmp/processpdf_summary.md`) leaks between PDFs.
5. **Schema Preservation**: No changes to `schedules/manifest.json` structure or client API (`Lair`).

## Architecture & Workflow Flow

```mermaid
flowchart TD
    A[Start Ingestion Loop] --> B{Find PDFs in schedules/inbox}
    B -->|No PDFs| C[Exit 0]
    B -->|PDFs Found| D[Pick Next PDF]
    D --> E[rm -rf .tmp state cleanup]
    E --> F[Check if PR already open]
    F -->|PR open| G[Skip PDF & continue]
    F -->|No PR| H[Run index.ts conversion]
    H --> I{Conversion & npm test success?}
    I -->|Success| J[Commit & Push Branch]
    J --> K[Create PR & Enable Auto-Merge]
    K --> L[Poll PR State until MERGED or Timeout]
    L -->|Merged| M[Git checkout main & pull latest]
    L -->|Timeout/Closed| N[Log warning & reset to main]
    M --> O{More PDFs in inbox?}
    N --> O
    I -->|Failure| P[Commit & Push Branch]
    P --> Q[Create FAILED PR without auto-merge]
    Q --> R[Git checkout main & reset --hard]
    R --> O
    O -->|Yes| D
    O -->|No| S[Done]
```

## Detailed Changes

### 1. Component: `.github/workflows/ingest-pdf.yml`

#### A. Full State Cleanup per Iteration
Before processing each PDF file at the start of the loop:
```bash
rm -rf .tmp
```

#### B. Merge Wait & Timeout Loop
For successful processing attempts where auto-merge is enabled:
- Execute `gh pr merge "$branch_name" --auto --merge --delete-branch`.
- Poll PR state via `gh pr view "$branch_name" --json state` every 5 seconds up to a max limit of 300 seconds (60 iterations).
- **If Merged**:
  ```bash
  git checkout main
  git fetch origin main
  git reset --hard origin/main
  ```
- **If Timeout or Closed without merge**:
  - Print warning with PR URL: `PR for $branch_name did not merge within 300 seconds (or was closed). Leaving PR open for manual inspection.`
  - Reset local working directory back to `main`: `git checkout main && git reset --hard origin/main`.
  - Proceed to the next PDF in `files`. (Note: Since PR 1 was not merged to `main`, `main` remains clean, allowing PDF 2 to branch off clean `main`).

#### C. Non-blocking Failure Recovery
For attempts where parsing or `npm test` fails:
- Execute `gh pr create --title "[FAILED] Auto-ingest schedule: $(basename "$file")" ...`.
- Do NOT enable auto-merge.
- Immediately clean up local working tree and sync to `main`:
  ```bash
  git checkout main
  git reset --hard origin/main
  ```
- Log diagnostic message and proceed to the next PDF in `files`.

### 2. Component: `.github/workflows/validate.yml`

#### Concurrency Group Adjustment
Separate job-level or workflow-level concurrency so PR validation runs do not cancel GitHub Pages deployment runs:
```yaml
concurrency:
  group: "validate-pr-${{ github.event.pull_request.number || github.sha }}"
  cancel-in-progress: true
```

## Verification Plan

### Automated Testing
- Execute Vitest suite: `npm test`.

### Manual / Workflow Verification
- Validate workflow YAML syntax using `npx action-validator` or GitHub Actions linting.
- Verify bash loop handles `MERGED`, `FAILED`, and timeout states cleanly.
