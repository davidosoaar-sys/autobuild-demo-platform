# AutoBuild working agreement

## Product and scope
Read PRODUCT.md, DESIGN.md, this file, and relevant code before changes. State
the intended operator outcome and scope. Maintain product truth as work changes:
distinguish implemented code, demonstrations, planned hardware, and unverified
provider or printer connections. Do not import another project's features or brand.

## Git and shared work
Before each logical change, inspect status, branch, and upstream, then run
`git pull --ff-only`. Inspect recent contributor changes before editing. Preserve
local work: never reset, discard, or automatically stash it. Report overlapping
edits and reconcile through an authorized checkpoint or merge. Do not push, tag,
or deploy without authorization. Never commit secrets or .env files.

## Versions and patch notes
Preserve the existing version (package.json currently starts this agreement at
1.0.0); do not restart numbering or assume it proves a deployed release.
Use vMAJOR.MINOR.PATCH: PATCH for fixes/design/docs, MINOR for features, and MAJOR
according to the project's release policy. Keep local changes under Unreleased
in CHANGELOG.md, without bumping a version for each edit or WIP.
At an authorized release, synchronize package.json, package-lock.json's top-level
version and packages[""].version (JSON omits v), add a dated changelog entry,
commit, annotate the version tag, and push only the intended branch/tag.
Verify deployment status before describing a change as live.

## Design and artifacts
Follow DESIGN.md and relevant Impeccable guidance for UI work. Preserve approved
fonts, assets, colours, and application chrome. Use authoritative research when
needed; component libraries are references, not substitutes for operator needs.
Never invent logos, font names, customer evidence, measurements, or performance.
Use purposeful diagrams and charts based on actual values. Preview UI changes
in the real renderer at desktop/mobile and applicable light/dark modes. Check
contrast, loading/empty/error states, wrapping, and reduced motion.
Hardware renders are concepts, not validated dimensions, component fit, sealing,
runtime, field of view, or measurement accuracy.

## Agent and integration boundaries
For agent commands specify triggers, allowed inputs/connectors, processing,
good-output examples, evaluation, and deterministic versus judgment boundaries.
Code owns calculations, validation, permissions, and saving; agents propose
sourced findings. Unknown is valid. Show assumptions and preserve user input.
Keep visual defect judgments distinct from calibrated dimensional measurements.
Do not infer working printer control, sensor telemetry, or Pi discovery from UI
labels, timed demos, or local state changes.

## Validation and handoff
Run checks appropriate to the change. Separate offline verification from live
API, hardware, and printer checks; disclose unavailable or failed checks. Use
isolated fictional print jobs for demos, preserving actual project data.
Maintain concise patch notes and PRODUCT.md. Coordinate backend ownership and
preserve authored content. Report changes, validation, limitations, and release
or deployment status. Do not claim automatic synchronization or publishing based
on a status label alone.
