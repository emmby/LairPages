# Track Banner HTML to Markdown Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert raw HTML formatting tags (`<b>`, `<i>`, `<br/>`) in track banners to Markdown during `LairPages` ingestion post-processing, and update `Lair`'s `TrackBanner` widget to render Markdown formatting.

**Architecture:** In `LairPages`, Step 4 post-processing (`step4-postprocess.ts`) will convert HTML tags in `matchingStep0Track.banner` to standard Markdown syntax. Existing ingested 2026 schedules will be re-processed to update their JSON files. In `Lair`, `TrackBanner` will render banner strings via `MarkdownBody`.

**Tech Stack:** TypeScript (Node.js, Genkit, Zod), Dart/Flutter (`flutter_markdown`, Riverpod).

## Global Constraints

- Preserve existing event description cleaning behavior in `LairPages`.
- Ensure all tests in `LairPages` pass (`npm test`).
- Ensure all tests in `Lair` pass across both iOS and non-iOS platform configurations per workspace rules (`flutter test`).
- Always add requirements to the implementation plan.

---

### Task 1: Add HTML-to-Markdown Banner Cleaning in `LairPages` Post-Processing

**Files:**
- Modify: `src/flows/step4-postprocess.ts`
- Modify: `test/postprocess.test.ts`

**Interfaces:**
- Produces: `cleanBanner(banner: string | null | undefined): string | null` helper in `src/flows/step4-postprocess.ts` used by `step4PostProcessFlow`.

- [ ] **Step 1: Write failing unit tests for banner HTML conversion**

Add tests to `test/postprocess.test.ts` verifying `cleanBanner` and `step4PostProcessFlow` convert `<b>`, `<i>`, and `<br/>` HTML tags in track banners to Markdown.

```typescript
describe('cleanBanner', () => {
  it('converts bold HTML tags to markdown', () => {
    expect(cleanBanner('<b>Adult Swim</b>')).toBe('**Adult Swim**');
  });

  it('converts italic HTML tags to markdown', () => {
    expect(cleanBanner('<i>Note:</i> swim at your own risk')).toBe('_Note:_ swim at your own risk');
  });

  it('converts line breaks to newlines or spaces', () => {
    expect(cleanBanner('Line 1<br/>Line 2')).toBe('Line 1\nLine 2');
  });

  it('returns null for null or empty banner', () => {
    expect(cleanBanner(null)).toBeNull();
    expect(cleanBanner('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/postprocess.test.ts`
Expected: FAIL with `cleanBanner is not defined` or assertion error.

- [ ] **Step 3: Implement `cleanBanner` in `src/flows/step4-postprocess.ts`**

Add `cleanBanner` implementation and apply it to `matchingStep0Track.banner`:

```typescript
export function cleanBanner(banner: string | null | undefined): string | null {
  if (!banner || banner.trim().length === 0) return null;

  let processed = banner
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`');

  processed = processed
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '_$1_')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '_$1_')
    .replace(/<br\s*\/?>/gi, '\n');

  return processed.trim();
}
```

In `step4PostProcessFlow`:
```typescript
const banner = matchingStep0Track?.banner ? cleanBanner(matchingStep0Track.banner) : null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/postprocess.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/flows/step4-postprocess.ts test/postprocess.test.ts
git commit -m "feat: convert track banner HTML to Markdown in step4 post-processing"
```

---

### Task 2: Re-process Ingested 2026 Schedule JSON Files in `LairPages`

**Files:**
- Modify: `schedules/2026/*/*.json`

**Interfaces:**
- Consumes: Updated `step4PostProcessFlow` in `LairPages`.

- [ ] **Step 1: Write/run script to re-run post-processing on existing 2026 schedule files**

Create a temporary script or run a node command that reads each existing schedule JSON in `schedules/2026/`, cleans all `banner` strings using `cleanBanner()`, and saves the updated JSON back to disk.

- [ ] **Step 2: Verify `schedules/2026/oski/week_09.json` no longer contains HTML tags in banners**

Check `schedules/2026/oski/week_09.json` to confirm:
- `<b>Adult Swim...</b>` is now `**Adult Swim...**`
- Nature/Hiking banner `<b>Check out...</b>` is now `**Check out...**`

- [ ] **Step 3: Commit schedule updates**

```bash
git add schedules/2026/
git commit -m "fix: re-process ingested 2026 schedule banners to Markdown"
```

---

### Task 3: Update Flutter `TrackBanner` Widget in `Lair` to Render Markdown

*Note: Task 3 files belong to the separate `emmby/Lair` repository.*

**Files:**
- Modify: `client/lib/src/ui/components/track_banner.dart`
- Modify: `client/test/track_banner_test.dart`

**Interfaces:**
- Consumes: Cleaned Markdown banner strings from schedule JSON data.

- [ ] **Step 1: Write/update widget tests for `TrackBanner` with Markdown rendering**

Add/update tests in `client/test/calendar_test.dart` to verify `TrackBanner` renders Markdown formatted text (`**bold**`, `_italic_`) correctly under both iOS (`TargetPlatform.iOS`) and Android/Material (`TargetPlatform.android`) platform overrides.

```dart
testWidgets('TrackBanner renders Markdown styled text on iOS and Android', (tester) async {
  debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
  // Render TrackBanner with a Markdown banner string like "**Adult Swim**"
  // Verify MarkdownBody renders text widget containing "Adult Swim" with bold styling
  debugDefaultTargetPlatformOverride = null;
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `flutter test client/test/calendar_test.dart`
Expected: Verification of widget tree and markdown parsing.

- [ ] **Step 3: Update `TrackBanner` implementation to use `MarkdownBody`**

In `client/lib/src/ui/components/track_banner.dart`:
Replace:
```dart
child: Text(
  bannerMessage,
  style: TextStyle(
    fontWeight: FontWeight.w500,
    color: Colors.blueGrey.shade800,
    fontSize: 12,
  ),
),
```

With:
```dart
child: MarkdownBody(
  data: bannerMessage,
  styleSheet: MarkdownStyleSheet(
    p: TextStyle(
      fontWeight: FontWeight.w500,
      color: Colors.blueGrey.shade800,
      fontSize: 12,
    ),
    pPadding: EdgeInsets.zero,
  ),
),
```

Ensure `package:flutter_markdown/flutter_markdown.dart` is imported.

- [ ] **Step 4: Run all Flutter tests to verify passes**

Run: `flutter test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add client/lib/src/ui/components/track_banner.dart client/test/
git commit -m "feat: render track banner with MarkdownBody in TrackBanner widget"
```
