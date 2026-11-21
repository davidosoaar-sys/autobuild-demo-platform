# AutoBuild V1 release access

The shared-workspace routes remain closed by default. A local production build with no pilot configuration was verified to redirect Pre-Print, Live Monitor, Post Processing, Report, the research API, and the development replay to `/slicer`.

An optional HTTPS-only pilot challenge is scoped to the four workspace pages and `/api/pre-print-research`. `AUTOBUILD_V1_PILOT_SHA256` must be a lowercase SHA-256 hex digest of a newly generated high-entropy, printable ASCII credential (32–96 characters). It is not a user-chosen password hash and is not an account session. Pass it through the hosting provider's server-only configuration, not a public JS variable, commit, or chat. The username is `operator`. An unset or invalid configuration keeps all four production pages and research closed. The research handler rechecks the credential and same-origin headers. Proxy, sync, legacy analysis, and Pod routes remain closed.

The shared pilot credential is for controlled, non-customer evaluation only. Before enabling externally, verify the supported patched framework runtime, HTTPS termination, provider-level protection where available, no caching, anonymous and incorrect-credential denial, opt-out by removing the server setting, and authenticated navigation. Do not use a pilot credential as proof of Supabase account/project membership. Before using real project data or enabling any paid API, verify user identity and project-scoped data authorization independently, including denial across projects.

`node --test tests/live-monitor-entry.test.mjs` covers default-closed, scoped challenge, authorized access, HTTP denial, and APIs remaining closed. No hosting settings were changed by these tests.
