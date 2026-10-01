# Conductor — notes for Claude Code

- Read `docs/R2_BUILD-SPEC.md` (this repo's milestones) and
  `docs/CONTENT-PIPELINE-ARCHITECTURE.md` (cross-repo design) before working.
- Conductor stays the smallest service: no database, no server, no UI. If a
  change wants to remember state between runs or render anything, that
  belongs in EmailServer.
- The Issue payload from Content Builder is passed to EmailServer unchanged —
  never reshape it here.
- Work one milestone at a time; verify locally against real deployed services
  before calling it done. Commit/push only when asked.
- Sibling repos (read-only reference from here): `../EmailServer`, `../ContentBuilder`.
