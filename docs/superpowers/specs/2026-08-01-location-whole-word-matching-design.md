# Design Spec: Whole-Word Location Matching in `resolveEventLocation`

Date: 2026-08-01  
Issue: [emmby/LairPages#51](https://github.com/emmby/LairPages/issues/51)

## Context & Problem
Currently, `resolveEventLocation` and `step3LocationFlow` perform exact full-string matching against location fields (e.g. `location: "DH"` matches `"dh"`).

When event location strings contain phrase context (e.g., `location: "Found near the DH"` or `location: "At the pool"`), `resolveEventLocation` fails to map embedded location names because it checks for exact full-string equality.

## Proposed Solution
Update `resolveEventLocation` in `src/flows/step3-location.ts` to perform whole-word substring matching using word boundary regular expressions (`\b`).

### Detailed Algorithm

1. **Input Validation & Fast Path**:
   - If `location` is `null`, `undefined`, or empty, return as-is.
   - If `mappingMap` contains an exact full-string match for `cleanLoc.toLowerCase()`, return the mapped value directly.

2. **Key Preparation (Upfront)**:
   - Extract and sort all keys from `mappingMap` by string length in descending order (`sortedKeys`). This ensures longer phrases (e.g. `"gold pool"`) match and replace before shorter sub-phrases (e.g. `"pool"`).

3. **Sequential Matching & Markdown Link Protection**:
   - For each key in `sortedKeys`:
     - Parse the current `location` string into segments:
       - Markdown link segments (`\[[^\]]+\]\([^)]+\)`)
       - Plain text segments
     - For each plain text segment:
       - Construct whole-word RegExp: `new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi')`.
       - Replace matching whole-word occurrences with the mapped markdown value from `mappingMap`.
     - Re-assemble plain text and markdown link segments into the updated `location` string before processing the next key.

4. **Word Boundary Behavior**:
   - `\bdh\b` matches `"DH"` in `"Found near the DH"`.
   - `\bdh\b` does **not** match `"dh"` in `"Wednesday"` (preceded by 's') or `"Windhaven"` (followed by 'a').

## Testing & Verification Plan

Add test cases to `test/location.test.ts`:
- **Phrase Context Matching**: `resolveEventLocation("Found near the DH", mappingMap)` -> `"Found near the [DH](maplocation://blue/dining_hall)"`.
- **Word Boundary Protection**: Verify `"Wednesday"` and `"Windhaven"` are not matched when `"DH"` is in `mappingMap`.
- **Markdown Protection**: Verify sequential key replacements do not alter existing/newly created markdown links or URLs.
- **Multiple Locations in Phrase**: Verify `"Volleyball Court / Pool"` replaces both correctly.
- **Exact & Pass-Through Matching**: Verify existing exact match and pass-through behavior for unrecognized or null locations.
