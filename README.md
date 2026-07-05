# LairPages

Public static asset hosting for the Lair schedule application.

This repository hosts the static JSON schedules and the global manifest under the `schedules/` directory, served via GitHub Pages at:
`https://emmby.github.io/LairPages/schedules/`


For details on the schedule conversion pipeline, diagnostic utilities, and setup guides, see the [Tool README](file:///Users/mike/.gemini/antigravity/worktrees/LairPages/fix-pdf-grouping-logic/tool/README.md).

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
