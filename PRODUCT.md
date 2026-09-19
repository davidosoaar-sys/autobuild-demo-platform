# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Print operators and site engineers who prepare and monitor 3D concrete prints, and architects/planners who upload floor plans and need printable, optimized toolpaths. The platform is also shown to demo audiences (clients, partners, investors), so first impressions matter alongside daily task use.

## Product Purpose
AutoBuild AI takes a building from site plan to print. It reads floor plans and site plans (including HEIC photos), traces walls and openings, slices them into layers, optimizes the print path before printing, and monitors bead quality during printing. Success is a print job that is ready, optimal, and verifiably going well.

## Positioning
One end-to-end pipeline for concrete 3D printing: AI reads the plan, the optimizer plans the layers and paths for concrete extrusion, and live monitoring closes the loop on the printed bead. A generic slicer or CAD tool covers only one of these steps.

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
