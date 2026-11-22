# Changelog

## Unreleased

## 1.1.2 (2026-11-22)

- Enable Projects and manual Printer Setup with browser-local records, and restore dashboard links to Settings and Help. Cloud project access, hardware discovery, and paid APIs are not opened. Automated storage and route tests cover the change.

## 1.1.1 (2026-11-22)

- Make the dashboard the public homepage. The slicer remains available from its dashboard card; the public dashboard does not load saved slice history or open gated tools and APIs. Verified the homepage, slicer picker, and anonymous route checks against a local production build.

## 1.1.0 (2026-11-21)

- Bring the monochrome glass theme, self-hosted Geist, and persistent light/dark controls to the dashboard and core print workflow.
- Add Pre-Print printer and material research with operator review, batch-window checks, and full G-code download. Live research requires a server-side API key and private pilot configuration.
- Add material consistency and temperature display slots, and save video-input events and observations alongside material information. No raw video is recorded.
- Add planned 3D layer review, operator feedback, and evidence export. Pod transport, hosted Supabase setup, and offline sync are excluded.
- Update the web framework and compatible visual dependencies. Verify the production build, generated route types, scoped tests, and private routes closed by default. Actual hardware and live provider calls are not part of these checks.
