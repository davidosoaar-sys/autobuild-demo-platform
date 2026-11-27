# AutoBuild platform (demo platform)

Operator-facing platform for 3D concrete printing: pre-print planning, live monitoring, and a post-print record. The technician stays in control; the platform flags and records, it does not adjust the printer.

This repository has **two deployables**:

| Part | Stack | Runs where |
|---|---|---|
| Web app | Next.js 14 (App Router), TypeScript, Tailwind | Vercel (project linked in the Vercel dashboard; nothing in the repo pins it) |
| Backend | FastAPI + a Stable-Baselines3 RL model | Railway, built from `backend/Dockerfile` via `railway.toml` |

Status note: the workspace routes (Pre-Print, Live Monitor, Post Processing, Report, the research API, replay) are **closed by default** and gate behind a pilot credential. See `docs/v1-release-access.md`. Nothing in the repo connects to real Pod or CCU hardware yet.

Branch note: this file documents the platform as it stands on the `autobuild/v1-revamp` branch. `docs/ccu-display.md`, `docs/pod-camera-local.md`, `docs/pod-video-local.md`, `supabase/migrations/`, `app/api/field-record-sync/`, and the `.env.example` next to this file are on that branch and are **not yet on `main`**; on `main`, read those sections as descriptions of work in progress rather than files you can open.

## Repository layout

```
app/                    Next.js routes (dashboard, tools, workspace pages, API handlers)
components/             Shared UI
lib/                    Shared logic, Supabase client, workspace state
backend/                FastAPI app + RL model (model.zip) + slicer modules
supabase/migrations/    Database migrations (apply manually; see below)
scripts/                Pod camera / Pod video bench publishers
docs/                   Feature-level handoff notes (access, CCU display, Pod camera, Pod video)
tests/                  Node test files (node --test)
AGENTS.md               Agent workflow rules (present locally; see Known gaps)
PRODUCT.md, DESIGN.md   Product scope and design system
CHANGELOG.md            Change log (present locally; see Known gaps)
```

## Prerequisites

- Node.js 20+ (Next 14 requires 18.17+; the Pod video launcher documents Node 20+, and its browser smoke test needs Node 22+)
- Python 3.11 for the backend (matches `backend/Dockerfile`)
- No database server needed for a UI-only run; Supabase is remote

## Run the web app locally

```bash
npm ci             # use ci, not install, to respect package-lock.json
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`.

The app boots without Supabase credentials, but any route that reads or writes project data will not work until `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set. For a fixture-only smoke run, point the Supabase URL at an unused loopback port and use a non-secret placeholder key; never use production credentials for fixture tests.

## Run the backend locally

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install torch==2.3.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

The web app reaches it through the proxy route `app/api/backend/[...path]/route.ts`, which forwards to `BACKEND_ORIGIN` and attaches `BACKEND_API_SECRET`. A few tool pages call `NEXT_PUBLIC_API_URL` directly.

## Environment variables

Server-only values belong in `.env.local` locally and in each host's own settings. Only `NEXT_PUBLIC_*` values are exposed to the browser. Start from `.env.example`.

| Variable | Scope | Used by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | `lib/supabase.ts`, sync route | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | `lib/supabase.ts`, sync route | Anon key; row-level security is what protects data |
| `NEXT_PUBLIC_API_URL` | public | slicer + monitor tools | Backend base URL, defaults to `http://localhost:8000` |
| `BACKEND_ORIGIN` | server | backend proxy route | Defaults to `http://localhost:8000` |
| `BACKEND_API_SECRET` | server | backend proxy route | Shared secret sent to FastAPI; never reaches the browser |
| `ANTHROPIC_API_KEY` | server | `/api/analyze-beads`, `/api/analyze-site-plan` | Image and plan analysis |
| `AUTOBUILD_RESEARCH_OPENAI_KEY` | server | `/api/pre-print-research` | Parameter/material research lookup |
| `AUTOBUILD_RESEARCH_MODEL` | server | `/api/pre-print-research` | Overrides the default research model |
| `AUTOBUILD_PROFILE_STORE_PATH` | server | `/api/pre-print-research` | Local dev only; profile store path |
| `AUTOBUILD_V1_PILOT_SHA256` | server | pilot gate, research route | Lowercase SHA-256 of a high-entropy credential, 32–96 printable ASCII chars. Unset or invalid keeps the routes closed. Username is `operator`. |
| `PORT` | server | backend container | Defaults to 8000 |
| `MODEL_PATH` | server | backend | Defaults to `model.zip`; keep the model file committed for Railway |

Bench-only Pod settings (`AUTOBUILD_LOCAL_CAMERA_ENABLED`, `AUTOBUILD_CAMERA_VIEWER`, `AUTOBUILD_CAMERA_OVERHEAD`, `AUTOBUILD_LOCAL_VIDEO_ENABLED`, `AUTOBUILD_VIDEO_*`) live in an owner-only launcher file outside the repo, never in `.env`, `NEXT_PUBLIC_*`, command-line arguments, or chat. See `docs/pod-camera-local.md` and `docs/pod-video-local.md`.

## Third-party services

| Service | Role | Failure impact |
|---|---|---|
| Supabase | Hosted Postgres + auth, project and run data, field-record sync | Project data unavailable; no local copy |
| Anthropic | Image and site-plan analysis | Analysis routes fail; upload and save still work |
| OpenAI | Pre-print research lookup | Research lookup fails; operator-entered values still work |
| OpenWeatherMap | Weather for the slicer's schedule | Slicer weather call fails |
| Vercel | Web app hosting | App offline |
| Railway | Backend hosting | Slicer/optimizer unavailable |

No service has an offline or local fallback. Offline mode is on hold (see Notion, feature 4).

## Database

One migration is in the repo:

```
supabase/migrations/20261121000000_field_record_sync_v1.sql
```

It creates the private `field_record_sync_private` schema, `run_grants` and `events` tables, row-level security, and the `ingest_v1` function. Apply it to the intended Supabase project manually; the app does not run migrations on boot. It is written to be applied as a whole (it opens with `begin;`).

Payments, billing, or hosted configuration changes are not part of this repository.

## Deploy

- **Web app:** Vercel, from `main`. Add the server-only variables in the Vercel project settings; do not commit them. There is no `vercel.json`, so build and route settings are whatever the dashboard holds.
- **Backend:** Railway, from `main`, using `railway.toml`: Dockerfile builder, `restartPolicyType = on_failure`, `restartPolicyMaxRetries = 3`.

Keep `model.zip` committed: `backend/Dockerfile` copies the whole `backend/` directory and Railway needs the model file present.

## Gating

Workspace routes are closed by default and there is a separate development-only loopback allowance. Before enabling external access, work through the checklist in `docs/v1-release-access.md` (HTTPS termination, provider-level protection, no caching, anonymous denial, authenticated navigation). A pilot credential is for controlled evaluation only and is not proof of Supabase account or project membership.

## Tests

```bash
node --test tests/*.test.mjs      # unit and route tests
node --test tests/*.test.cjs      # route visibility tests
```

Feature-specific coverage is listed in each `docs/*.md` file. Browser suites need Playwright and Chromium, and some snapshot a checkout without middleware; read the relevant doc first.

## Backup and restore

**There is no documented backup and restore procedure, and no automated backup exists.** This is a real gap for a pilot, not a technicality. What exists today:

- Project and run data lives in hosted Supabase only. There is no named export job, no retention policy, and no restore test on record.
- Post-print evidence (review thumbnails, notes, exported JSON) is stored browser-local. Clearing site data deletes it; the app warns you to export JSON first.
- The RL model and slicer code ship inside the backend image, so a re-deploy restores the code path but not any data or `results/` output written at runtime.
- Nothing in the repo captures a database dump.

Minimum to close this: a scheduled `pg_dump` of the Supabase project to storage outside the project, plus one restore rehearsal into a scratch project and a written record of the result. Until that is done, treat hosted project data as unrecoverable if the project is lost.

## Known gaps

- **Leaked OpenWeatherMap API key.** `backend/main.py` and `backend/weather.py` carry a hardcoded OpenWeatherMap key that is committed on `main` in a public repository. It must be rotated and moved to an environment variable. Rotate at the provider first, since the old value stays in Git history.
- **No `.env.example`** was tracked before now; the variable list above came from reading the code.
- `AGENTS.md` and `CHANGELOG.md` exist in the working tree but are **not tracked** in Git. `PRODUCT.md` and `DESIGN.md` are tracked.
- The previous version of this README described only the Pre-Print Optimizer and a Windows/TKS setup; it had drifted well behind the app.
- Offline mode, CCU telemetry, calibrated bead measurement, and defect-model training are not implemented. Do not describe the platform as connected to hardware.
