# Sequential PDF Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the LairPages PDF ingestion pipeline to process inbox PDFs sequentially with automatic merge waiting, clean state isolation (`rm -rf .tmp`), and non-blocking failure recovery.

**Architecture:** Update `.github/workflows/ingest-pdf.yml` to loop through inbox PDFs sequentially, waiting for each auto-merged PR to land on `main` before fetching `main` and processing the next file. Update `.github/workflows/validate.yml` concurrency configuration to prevent PR validation runs from cancelling deployment runs.

**Tech Stack:** GitHub Actions (YAML), Bash shell scripting, GitHub CLI (`gh`).

## Requirements
- Always add the requirements to the implementation plan.
- Multi-File Batch Support: Handle multiple inbox PDFs in a single run without triggering git merge conflicts in `schedules/manifest.json`.
- Individual PRs: Process each PDF in its own dedicated Pull Request.
- Non-Blocking Recovery: On PDF parsing or test failure, open `[FAILED]` PR without auto-merge, reset to `main`, and continue to remaining PDFs.
- Clean State Isolation: Wipe `.tmp` directory via `rm -rf .tmp` at the start of each loop iteration.
- Concurrency Protection: Ensure PR validation runs do not cancel GitHub Pages deployment runs in `validate.yml`.
- Schema Preservation: Maintain existing `schedules/manifest.json` structure and API contracts without alteration.

---

### Task 1: Update Concurrency Configuration in `validate.yml`

**Files:**
- Modify: `.github/workflows/validate.yml:15-18`

**Interfaces:**
- Consumes: GitHub Actions concurrency context (`github.event.pull_request.number`, `github.sha`).
- Produces: Isolated concurrency scope for PR status checks.

- [ ] **Step 1: Inspect existing concurrency settings in `validate.yml`**

Run: `cat .github/workflows/validate.yml`
Expected: View current concurrency group set to `"pages"`.

- [ ] **Step 2: Update concurrency group in `validate.yml`**

Edit `.github/workflows/validate.yml` to replace the workflow-level concurrency block:

```yaml
concurrency:
  group: "validate-pr-${{ github.event.pull_request.number || github.sha }}"
  cancel-in-progress: true
```

- [ ] **Step 3: Verify syntax of `validate.yml`**

Run: `npx -y action-validator .github/workflows/validate.yml` or `git diff .github/workflows/validate.yml`
Expected: Clean diff showing unique concurrency group per PR.

- [ ] **Step 4: Commit `validate.yml` changes**

```bash
git add .github/workflows/validate.yml
git commit -m "ci: isolate validate.yml PR concurrency groups"
```

---

### Task 2: Refactor `.github/workflows/ingest-pdf.yml` Loop for Sequential Merging & State Cleanup

**Files:**
- Modify: `.github/workflows/ingest-pdf.yml:69-175`

**Interfaces:**
- Consumes: `gh` CLI commands (`gh pr list`, `gh pr create`, `gh pr merge`, `gh pr view`).
- Produces: Sequential loop with state cleanup, merge-wait loop, and non-blocking failure recovery.

- [ ] **Step 1: Add `.tmp` state cleanup at start of loop iteration**

Inside `.github/workflows/ingest-pdf.yml`, add `rm -rf .tmp` right after `echo "Processing: $file"`:

```bash
rm -rf .tmp
```

- [ ] **Step 2: Add PR merge-wait loop and main sync logic**

In `.github/workflows/ingest-pdf.yml`, update the post-PR-creation logic when `success=true` and tests pass:

```bash
gh pr merge "$branch_name" --auto --merge --delete-branch

echo "Waiting for PR on $branch_name to auto-merge into main..."
merged=false
for i in {1..60}; do
  pr_state=$(gh pr view "$branch_name" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
  if [ "$pr_state" = "MERGED" ]; then
    echo "PR $branch_name successfully merged into main."
    merged=true
    break
  elif [ "$pr_state" = "CLOSED" ]; then
    echo "PR $branch_name was closed without merging."
    break
  fi
  sleep 5
done

if [ "$merged" = "true" ]; then
  git checkout main
  git fetch origin main
  git reset --hard origin/main
else
  echo "WARNING: PR $branch_name did not merge within 300 seconds or was closed. Leaving PR open and continuing."
  git checkout main
  git reset --hard origin/main
fi
```

- [ ] **Step 3: Update failure recovery branch cleanup**

In `.github/workflows/ingest-pdf.yml`, ensure failure paths (when `success=false` or tests fail) reset the local repository to `main` before looping:

```bash
git checkout main
git reset --hard origin/main
```

- [ ] **Step 4: Verify test suite and workflow syntax**

Run: `npm test`
Expected: Vitest tests pass cleanly.

- [ ] **Step 5: Commit `ingest-pdf.yml` changes**

```bash
git add .github/workflows/ingest-pdf.yml
git commit -m "ci: refactor ingest-pdf workflow for sequential merging and state isolation"
```

---

### Task 3: End-to-End Verification & Walkthrough Update

**Files:**
- Modify/Create: Implementation Walkthrough artifact

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Verify git status**

Run: `git status`
Expected: Working tree clean with all commits recorded.
