# Whole-Word Location Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `resolveEventLocation` in `src/flows/step3-location.ts` to perform whole-word substring matching on location fields so embedded location names like `"DH"` in `"Found near the DH"` are resolved without matching words containing those letters (like `"Wednesday"` or `"Windhaven"`).

**Architecture:** `resolveEventLocation` will first check for an exact match in `mappingMap`. If no exact match is found, it will sort `mappingMap` keys by length descending, and iterate over each key. In each iteration, it splits the location string into plain text vs markdown link segments, applies whole-word regex matching (`\b<key>\b`) to replace whole-word occurrences in plain text segments with mapped markdown links, and re-assembles the string.

**Tech Stack:** TypeScript, Vitest, Node.js

## Requirements (from Issue #51 & Spec)
1. **Whole-Word Matching**: `resolveEventLocation` must perform whole-word substring matching on location fields.
   - Example: `location: "Found near the DH"` becomes `location: "Found near the [DH](maplocation://blue/dining_hall)"`.
2. **Word Boundary Enforcement**: Whole-word boundary checks (`\b`) must be enforced so words like `"Wednesday"` or `"Windhaven"` are not matched when matching `"DH"`.
3. **Markdown Link Protection**: Sequential key replacements must not corrupt existing or newly created markdown link text or URLs (`[Text](url)`).
4. **Backwards Compatibility & Edge Cases**:
   - Exact full-string matches in `mappingMap` continue to take precedence.
   - `null`, `undefined`, and empty strings are returned unchanged.
   - Unrecognized location strings remain plain text.

---

### Task 1: Implement Whole-Word Substring Matching in `resolveEventLocation` and Add Unit Tests

**Files:**
- Modify: `src/flows/step3-location.ts`
- Modify: `test/location.test.ts`

**Interfaces:**
- `resolveEventLocation(location: string | null | undefined, mappingMap: Map<string, string>): string | null | undefined`

- [ ] **Step 1: Write failing unit tests in `test/location.test.ts`**

Add tests for:
1. Whole-word substring matching (`"Found near the DH"` -> `"Found near the [DH](maplocation://blue/dining_hall)"`).
2. Word boundary checks (`"Wednesday"` and `"Windhaven"` untouched when `"dh"` is in mapping).
3. Markdown link protection (replacing multiple keys like `"volleyball court"` and `"court"` without corrupting links).
4. Multiple distinct locations in phrase (`"Volleyball Court / Gold Pool"`).

Edit `test/location.test.ts`:
```typescript
  test('maps embedded whole-word location strings within phrase context', () => {
    const mappingMap = new Map<string, string>([
      ['dh', '[DH](maplocation://blue/dining_hall)'],
      ['gold pool', '[Gold Pool](maplocation://gold/pool)'],
      ['volleyball court', '[Volleyball Court](maplocation://blue/sports_courts)'],
    ]);

    expect(resolveEventLocation('Found near the DH', mappingMap)).toBe('Found near the [DH](maplocation://blue/dining_hall)');
    expect(resolveEventLocation('At the gold pool after lunch', mappingMap)).toBe('At the [Gold Pool](maplocation://gold/pool) after lunch');
  });

  test('enforces word boundaries so substring words like Wednesday or Windhaven do not match DH', () => {
    const mappingMap = new Map<string, string>([
      ['dh', '[DH](maplocation://blue/dining_hall)'],
    ]);

    expect(resolveEventLocation('Wednesday at Windhaven', mappingMap)).toBe('Wednesday at Windhaven');
    expect(resolveEventLocation('Meet at DH on Wednesday', mappingMap)).toBe('Meet at [DH](maplocation://blue/dining_hall) on Wednesday');
  });

  test('protects markdown links from being corrupted by subsequent key replacements', () => {
    const mappingMap = new Map<string, string>([
      ['volleyball court', '[Volleyball Court](maplocation://blue/sports_courts)'],
      ['court', '[Court](maplocation://blue/court)'],
    ]);

    expect(resolveEventLocation('Volleyball Court / Court', mappingMap)).toBe('[Volleyball Court](maplocation://blue/sports_courts) / [Court](maplocation://blue/court)');
  });
```

- [ ] **Step 2: Run vitest to verify new tests fail**

Run: `npx vitest run test/location.test.ts`
Expected: FAIL on `maps embedded whole-word location strings within phrase context`

- [ ] **Step 3: Update `resolveEventLocation` implementation in `src/flows/step3-location.ts`**

Update `resolveEventLocation` in `src/flows/step3-location.ts`:
```typescript
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveEventLocation(location: string | null | undefined, mappingMap: Map<string, string>): string | null | undefined {
  if (!location) return location;
  const cleanLoc = location.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  // Fast path: exact match on full location string
  const exactMatch = mappingMap.get(cleanLoc.toLowerCase());
  if (exactMatch) return exactMatch;

  // Sort keys by length descending so longer phrases match first
  const sortedKeys = Array.from(mappingMap.keys()).sort((a, b) => b.length - a.length);

  let currentLoc = location;

  for (const key of sortedKeys) {
    const mappedVal = mappingMap.get(key);
    if (!mappedVal) continue;

    const keyRegex = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi');

    // Split string into markdown link segments and plain text segments
    const linkRegex = /\[[^\]]+\]\([^)]+\)/g;
    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(currentLoc)) !== null) {
      if (match.index > lastIndex) {
        parts.push(currentLoc.substring(lastIndex, match.index).replace(keyRegex, mappedVal));
      }
      parts.push(match[0]); // preserve existing markdown link intact
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < currentLoc.length) {
      parts.push(currentLoc.substring(lastIndex).replace(keyRegex, mappedVal));
    }

    currentLoc = parts.join('');
  }

  return currentLoc;
}
```

- [ ] **Step 4: Run vitest to verify `test/location.test.ts` passes**

Run: `npx vitest run test/location.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to ensure no regressions**

Run: `npm test`
Expected: 5 passed test files, all tests passing

- [ ] **Step 6: Commit changes**

Run:
```bash
git add src/flows/step3-location.ts test/location.test.ts docs/superpowers/plans/2026-08-01-location-whole-word-matching.md
git commit -m "feat: whole-word location matching in resolveEventLocation"
```
