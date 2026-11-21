# AutoBuild agent guide

- Read `PRODUCT.md` and `DESIGN.md`; use Notion Software Updates for scope and acceptance criteria.
- Work on feature branches after checking the worktree and upstream. Preserve uncommitted changes. Assign each file to one agent at a time.
- Run `node --test tests/*.test.mjs` for V1 domain code. Use the production build and browser checks before claiming release readiness. Name unverified checks and distinguish replay from hardware validation.
- Keep trial monitoring alert-only. Keep production routes gated and do not use customer data in local fixtures.
- Log changes under `Unreleased` in `CHANGELOG.md`. Only cut an annotated `vMAJOR.MINOR.PATCH` tag and update version fields for an authorized release. Do not push or deploy without authorization.
