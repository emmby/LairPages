# Sequential PDF Ingestion Pipeline Design Spec

## Overview
The LairPages ingestion pipeline processes schedule PDFs dropped into `schedules/inbox/` and creates Pull Requests for each schedule. Previously, when multiple PDFs were present in a single batch, concurrent PRs updated `schedules/manifest.json` from the same base branch state (`main`), resulting in merge conflicts in `manifest.json` for subsequent PRs.

This design updates `.github/workflows/ingest-pdf.yml` to process PDFs sequentially with an automated merge-wait loop and non-blocking failure recovery.

## Requirements & Constraints
1. **Multi-File Batch Support**: The workflow must cleanly process multiple PDFs in `schedules/inbox/` in a single run without triggering git merge conflicts in `schedules/manifest.json`.
2. **Individual PRs**: Each PDF must still be processed in its own dedicated Pull Request.
3. **Non-Blocking Recovery**: If a PDF fails parsing or unit/validation tests, its PR will be created as `[FAILED]` (without auto-merge), and the workflow will immediately proceed to process the remaining PDFs without stalling or failing the entire batch.
4. **Schema Preservation**: No changes to `schedules/manifest.json` structure or client API (`Lair`).

## Architecture & Workflow Flow

```mermaid
flowchart TD
    A[Start Ingestion Loop] --> B{Find PDFs in schedules/inbox}
    B -->|No PDFs| C[Exit 0]
    B -->|PDFs Found| D[Pick Next PDF]
    D --> E[Check if PR already open]
    E -->|PR open| F[Skip PDF & continue]
    E -->|No PR| G[Run index.ts conversion]
    G --> H{Conversion & npm test success?}
    H -->|Success| I[Commit & Push Branch]
    I --> J[Create PR & Enable Auto-Merge]
    J --> K[Wait for PR State == MERGED]
    K --> L[Git checkout main & pull latest]
    L --> M{More PDFs in inbox?}
    H -->|Failure| N[Commit & Push Branch]
    N --> O[Create FAILED PR without auto-merge]
    O --> P[Git checkout main & reset --hard]
    P --> M
    M -->|Yes| D
    M -->|No| Q[Done]
```

## Detailed Changes

### Component: `.github/workflows/ingest-pdf.yml`

#### 1. Merge Wait Loop
For successful processing attempts where auto-merge is enabled:
- Execute `gh pr merge "$branch_name" --auto --merge --delete-branch`.
- Poll PR state via `gh pr view "$branch_name" --json state,mergedAt` every 5 seconds until `state == "MERGED"` or timeout (300 seconds).
- Upon merge confirmation:
  ```bash
  git checkout main
  git fetch origin main
  git reset --hard origin/main
  ```

#### 2. Non-blocking Failure Recovery
For attempts where parsing or `npm test` fails:
- Execute `gh pr create --title "[FAILED] Auto-ingest schedule: $(basename "$file")" ...`.
- Do NOT enable auto-merge.
- Immediately clean up local working tree and sync to `main`:
  ```bash
  git checkout main
  git reset --hard origin/main
  ```
- Log diagnostic message and proceed to the next PDF in `files`.

## Verification Plan

### Automated Testing
- Execute Vitest suite: `npm test`.

### Manual / Workflow Verification
- Validate workflow YAML syntax.
- Verify bash loop handles both `MERGED` and `FAILED` states correctly.
