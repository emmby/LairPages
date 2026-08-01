# Track Banner HTML to Markdown Conversion Design

## Overview & Goal

During PDF ingestion in `LairPages`, Step 0 extracts visual text styling (such as bold headers or line breaks) as HTML tags (`<b>`, `<i>`, `<br/>`). While event descriptions are converted from HTML to Markdown in Step 4 post-processing, track banners currently bypass this cleaning step and retain raw HTML tags in the final schedule JSON output files.

Additionally, the Flutter client (`Lair`) renders track banners using a basic `Text` widget, which does not interpret Markdown syntax.

This feature will:
1. Update `LairPages` post-processing to clean track banners by converting HTML tags (`<b>`, `<i>`, `<br/>`, etc.) to standard Markdown.
2. Re-run post-processing on ingested 2026 schedule files to clean raw HTML tags in existing banners.
3. Update `Lair`'s `TrackBanner` widget to render banner text using `MarkdownBody`, matching the styling of event descriptions.

---

## Technical Details

### 1. Ingestion Pipeline (`LairPages`)

#### `src/flows/step4-postprocess.ts`
- Refactor/create HTML-to-Markdown text cleaning logic (`cleanBanner` or shared `cleanMarkdownText`).
- Transformations applied to track banners:
  - `<b\b[^>]*>([\s\S]*?)<\/b>` and `<strong\b[^>]*>([\s\S]*?)<\/strong>` $\rightarrow$ `**$1**`
  - `<i\b[^>]*>([\s\S]*?)<\/i>` and `<em\b[^>]*>([\s\S]*?)<\/em>` $\rightarrow$ `_$1_`
  - `<br\s*\/?>` $\rightarrow$ `\n` or space where appropriate
  - Trim trailing whitespace
- Update `step4PostProcessFlow` to process `matchingStep0Track.banner` through `cleanBanner` before returning `finalTracks`.

#### Data Migration / Regeneration
- Re-run Step 4 post-processing across all `schedules/2026/*/*.json` files to replace raw HTML tags (e.g. `<b>Adult Swim is the last 15 minutes of every hour.</b>`) with clean Markdown (`**Adult Swim is the last 15 minutes of every hour.**`).

---

### 2. Mobile App Client (`Lair`)

#### `client/lib/src/ui/components/track_banner.dart`
- Replace the current `Text(bannerMessage, style: ...)` with a `MarkdownBody` widget.
- Supply a custom `MarkdownStyleSheet` matching the existing design system tokens:
  - Paragraph text style: `fontSize: 12`, `fontWeight: FontWeight.w500`, `color: Colors.blueGrey.shade800`.
  - Ensure zero margin/padding on paragraph blocks to maintain vertical alignment within the banner container.

---

## Verification Plan

### Automated Tests
- **`LairPages` Tests**: Add unit tests in `test/step4-postprocess.test.ts` verifying that track banners containing `<b>`, `<i>`, and `<br/>` tags are cleanly converted to Markdown strings without retaining HTML tags.
- **`Lair` Widget Tests**: Update or add widget tests in `client/test/` to verify `TrackBanner` correctly renders Markdown text.

### Manual Verification
- Inspect generated `schedules/2026/oski/week_09.json` to verify that `<b>` tags in the Nature/Hiking banner are converted to Markdown `**`.
