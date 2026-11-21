# Post-print evidence

From an existing project with a recorded `report.printStartedAt`, use **Post-print evidence** to review a layer photo or attach a full AutoBuild G-code export. Read the resulting report and export evidence JSON without changing project status. The existing project completion action, PDF printing, and legacy image-analysis tool remain separate.

- The initial production record comes from the existing `Project.report` object. Its events and alerts are legacy observations, not proof of coverage. A missing `printFinishedAt` is unknown, not inferred from the report generation time.
- `lib/post-print-evidence.mjs` version 1 keys records by project ID and recorded print start. It reads the full export through `lib/autobuild-v1/toolpath.mjs` and keeps only the per-layer planned Z, deposition length and segment count. The supplied file is not automatically verified against the printer job. This is not an as-built 3D model.
- A review stores a bounded JPEG thumbnail, optional operator-entered layer number, save time, final label and note. A separate AI observation, when requested, comes from the existing `/api/analyze-beads`; no AI call is needed for a missed-defect note. The photo save time is not its capture time. Neither review nor JSON export trains a model.
- New evidence is browser-local; clearing site data removes it. Export JSON before clearing or switching devices. JSON can contain thumbnails and operator notes; use it only with people allowed to see the project. The slice does not add cloud sync, calibrated geometry, CCU sample history, or dataset consent and training integration.

## Verify locally

Run `node --test tests/post-print-evidence.test.mjs`. For browser coverage, use a disposable checkout snapshot **without** middleware, bind Next to `127.0.0.1:43997`, and configure `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:43998`, a non-secret `NEXT_PUBLIC_SUPABASE_ANON_KEY` placeholder, and `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` pointing to `tests/fixtures/next-font-loopback.cjs` in the snapshot. Never bypass project gating on a hosted or network-accessible environment. `python tests/post-print-browser.py` needs Playwright and Chromium; it stubs Supabase reads and the existing AI call, and checks the downloaded JSON. `POST_PRINT_CHROMIUM` can point to an installed Chromium executable. No provider permissions or printer hardware are tested.
