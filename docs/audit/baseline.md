# Baseline: typecheck and tests

Step 1 of the audit hand-off (pasted by the owner on 2026-11-05). Recorded on the owner's Windows 11 PC.

## Snapshot

- Branch `audit/baseline`, created from `main` at `a8be80f` (version 0.9.27 plus the 2026-11-05 microphone
  fixes). The hand-off described a 0.9.23 ZIP without `.git`; this baseline is on the git checkout.
- Node v22.13.0, npm 11.15.0, Windows 11 Pro 10.0.26300.

## Dependencies

- Not reinstalled for this step. `node_modules` was installed with `npm ci --cache G:/caches/npm` on
  2026-11-03 (scripts enabled) and updated by later `npm install` runs in this repo.
- `npm ci --ignore-scripts`, as the hand-off asks, was not run: skipping install scripts would leave
  dependencies that need them unbuilt (below) and would break the desktop app's local speech stack.
  Raised with the owner instead.
- Lifecycle scripts in the workspace `package.json` files (root, `apps/*`, `packages/*`): none
  (`preinstall`, `install`, `postinstall`, `prepare`, `prepack`, `postpack`, `prepublish` all absent).
- Dependencies whose lockfile entry has `hasInstallScript`: 8 entries, 6 packages: `esbuild@0.25.12`
  (3 copies), `esbuild@0.28.2`, `electron-winstaller@5.4.0`, `fsevents@2.3.3` (macOS only),
  `onnxruntime-node@1.30.0`, `protobufjs@7.6.6`.

## Commands and results

| Command | Exit code | Result |
|---|---:|---|
| `npm run typecheck` | 0 | no `error TS` lines; root `tsc --noEmit` plus `apps/web`, `apps/server`, `apps/powerpoint`, `apps/browser`, `apps/desktop` |
| `npm test` (`vitest run`) | 0 | 39 files passed, 1 skipped (40); 230 tests passed, 1 skipped (231); 1.22 s |

The one skipped test is `apps/web/lib/gauntlet/run.test.ts` "gauntlet (real providers)", gated by
`describe.skipIf(!on)` with `on = process.env.GAUNTLET === "1"`: it replays the corpus against real
decision providers and is skipped by design (paid calls).

## Comparison with HANDOFF

The hand-off quoted 198 tests with 1 skip (0.9.23). Now 230 with the same skip: the difference is the
tests added since (flat layout, pairing reopen, green tick, single layout, microphone picker, silence
detector, model download helpers). No test failed.

## Not verified here

- macOS and Linux: not run on this PC.
- The real-provider gauntlet (skipped, needs `GAUNTLET=1` and keys).
- A clean `npm ci` from an empty `node_modules`.
