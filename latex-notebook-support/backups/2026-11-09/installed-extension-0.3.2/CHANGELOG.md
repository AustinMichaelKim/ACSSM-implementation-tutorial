# Changelog

## 0.3.2 — 2026-09-28 — verification candidate

- Stop after the immediate typed/auto-paired delimiter instead of advancing directly to an outer native field or display final stop.
- Replace speculative native-next/previous and out-of-field manual moves with an atomic text-neutral boundary transaction. No new snippet placeholders are introduced.
- Keep native sequential-argument navigation authoritative: no whole-argument fallback in the active native path; accept empty native fields within nonempty arguments.
- Fix literal token end affinity; add lexical checks for escapes, comments and control-word boundaries.
- Preserve LF/CRLF, EOF and standalone display exit behavior, including a surviving outer native field.
- Preserve existing Space behavior. Delegate multiple/mirrored selections to VS Code instead of collapsing them.
- Serialize mutation commands, stop on focus changes, guard failed/concurrent edits and clean up long-prefix transient probes without restoring whole-document snapshots.
- Add optional default Tab routes without editing user keybindings/settings/snippets.
- Include original 0.3.1 negative controls, 119 local tests, a 42-case host acceptance suite, a model-only fixture smoke report, source audit and deterministic offline packager.
- Verification: local tests passed; real VS Code Extension Host and physical keyboard acceptance NOT executed in the build environment. Consult VERIFICATION.json.

## 0.3.1 — original record, validation candidate

Replaced manual outer typed-closer movement with native next navigation for the reported pd failure. That change could skip the required closer stop. The current original README permitted immediate x selection and did not require a separate ')' stop. The original package did not contain a passing runtime report.

## 0.3.0 — record available from original 0.3.1 package

The attempted hidden-final-stop synchronization still performed direct cursor movement. Prior diagnostic history reports snippet cancellation and whole-argument fallback. The 0.3.0 binary itself was not run for this delivery; the unsafe path is covered by a diagnostic-style model replay.
