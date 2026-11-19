# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Print operators and site engineers who prepare and monitor 3D concrete prints, and architects/planners who upload floor plans and need printable, optimized toolpaths. The platform is also shown to demo audiences (clients, partners, investors), so first impressions matter alongside daily task use.

## Product Purpose
AutoBuild AI takes a building from site plan to print. It reads floor plans and site plans (including HEIC photos), traces walls and openings, slices them into layers, optimizes the print path before printing, and monitors bead quality during printing. Success is a print job that is ready, optimal, and verifiably going well.

## Positioning
One end-to-end pipeline for concrete 3D printing: AI reads the plan, the optimizer plans the layers and paths for concrete extrusion, and live monitoring provides inspection feedback on the printed bead. Automatic feedback to a physical printer remains an integration dependency. A generic slicer or CAD tool covers only one of these steps.

## Three-Stage Workflow

1. **Pre-print:** configure the printer, prepare geometry, and plan layers and
   toolpaths using printer limits, material assumptions, and environmental inputs.
2. **Live monitor:** inspect deposited beads and record conditions, findings, and
   alerts during printing.
3. **Post-print:** review defects and combine preparation and inspection records
   into a report.

## Implementation and Hardware Status

- A printable fit-check casing is available in `hardware/inspection-pod/prototype-v1/`;
  this is shell geometry, not validated electronics packaging or a printer rig.

- Implemented code includes geometry/slicing and optimization endpoints, G-code
  generation, browser camera capture, image-based bead analysis, and project/report
  persistence. Availability of external services is not established by code review.
- Pi discovery in printer setup is currently a timed demonstration using fixed
  printer specifications. Monitoring controls update application state and logs;
  these do not establish a physical printer-control connection.
- Planned hardware includes two rechargeable wireless inspection pods for
  overhead and side bead views, a Pi inside each pod, and a separate printer
  gateway Pi. Ambient and material sensing nodes are also planned.
- The current pod concept uses a single-colour 3D-printed plastic enclosure,
  protected USB-C charging/service port, inductive charging, and a shared rear
  screw-lock interface for printer-specific rigs. Solar is excluded for now.
- RGB, LiDAR/depth, and laser profiling remain proposed sensing functions.
  Component selection, Pi drivers, telemetry ingestion, calibration, power/thermal
  design, runtime, rig clearance, and environmental protection require validation.
  A 200-degree RGB view and detection of 1 mm deviations are targets, not verified
  capabilities; depth/profiler coverage differs from the RGB field of view.

## Operating Context
Modes in the app: floorplan and wall viewer, pre-print optimizer (layer visualization, site plan reader), post-processing, printer setup, live monitoring, projects, reports, definitions, help. Backend is a Python API (geometry, openings, optimizer) with Supabase for saved slices; the front end is Next.js with 3D views (three.js). Some pipeline content is German (e.g. Wandlinien).

## Capabilities and Constraints
- Web app only, built with Next.js 14, Tailwind, framer-motion, react-three-fiber.
- Access is password-gated and the backend requires an API secret; this is not a public marketing site.
- First-run onboarding collects a name and requires acceptance of ToS and privacy terms; a greeting personalizes the home page.

## Brand Commitments
Keep the existing AutoBuild name and logo assets (public/). No other identity constraints were stated.

## Evidence on Hand
Real app screens and data flows exist in the repo. No testimonials, customer names, benchmarks or pricing were provided; do not fabricate them.

## Product Principles
- Show the real pipeline state (plan, layers, path, bead) instead of decoration.
- Precision and trust over spectacle: operators act on what they see.
- The same interface must work for a hands-on operator and a first-time demo viewer.
- Make the plan-to-print steps legible in order; never hide what the AI inferred.

## Accessibility & Inclusion
No product-specific requirement stated. Site use implies glare, gloves and tablets, so legibility and generous touch targets are worth respecting; this is inferred, not confirmed.
