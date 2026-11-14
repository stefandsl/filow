# Release checklist

## Verify, draft, smoke, then go live (R2)

Use `tools/release/release.ps1` with PowerShell 7, Node 22, the locked npm dependencies,
7-Zip on PATH (or `FILOW_RELEASE_7Z`), and the owner's stored `gh` login (`stefandsl`).
Keep release files, temporary data and caches on G:. The orchestrator copy is not updated;
do not use its publish/finish stages for the new release path.

1. Run the tests, typecheck and lint. Commit the version bump on main and push main through
   the normal reviewed process. Do not push the version tag yet. The repository script
   does not bump versions, commit, merge, push or tag for you.
2. Before building, save immutable preflight evidence:
   `pwsh tools/release/release.ps1 -Version X.Y.Z -Stage preflight -Commit <full-main-commit> -Work G:\release-X.Y.Z`.
   It requires the commit on remote main, a matching package version, a version strictly
   above feed Latest, and no existing source or feed release with that tag. Keep this file;
   do not regenerate it after building. CI also checks these conditions before tag builds.
3. Create/push the tag at that exact commit using the normal release procedure. Wait for
   Desktop builds to finish successfully on all three platforms. CI attaches assets only
   to the source repository. It has no feed credential and cannot publish the feed.
4. Run `-Stage draft` with the same version/work directory and `-Notes <reviewed-notes.md>`.
   The verifier checks CI identity/success, the unmoved tag, all 17 named assets, all manifest
   references/hashes/sizes, and the extracted Windows installer's version, sourceSha,
   accountOrigin and explicit `allowDowngrade = false`. A configured account origin is denied
   until the reviewed production origin is added to `allowedOrigins` in the verifier.
   Only then does the owner create a private feed draft. No Latest edit occurs here.
5. Manually dispatch Desktop builds at the release tag with `release_tag=vX.Y.Z` and
   `smoke_only=true`. This installs the source Windows installer silently on a clean runner,
   launches it once and uploads `smoke-result.json` to the source release using the default
   token. It is manual-only pending actual CI validation. The default token cannot read a
   different repository's private draft; publication instead requires this tested installer's
   SHA512 to equal the installer downloaded from the feed draft. No smoke evidence means no
   publication. The test proves startup, not onboarding completion or model inference.
6. Run `-Stage publish` with the same version/work directory. It downloads the draft afresh,
   repeats verification, checks the smoke digest and tag again, publishes with Latest false,
   sets Latest LAST, then reads the feed URL's `latest.yml` and compares bytes by SHA512.
   On any failure stop; do not substitute a count check or hand-edit manifests.
   A readback failure happens after visibility changes and requires immediate recall below.

Historical read-only audit (no release writes):
`node tools/release/release-verify.mjs audit --version 0.9.38 --dir G:\FILOW\tmp\r2-verify\0.9.38 --work G:\FILOW\tmp\r2-verify\extract-new`.
Download all release assets first. Audit checks published bytes and CI/source identity; it
cannot retroactively assert prebuild absence, version monotonicity, tag immutability, or smoke.
Extraction directories must be new. Current verification inspects the Windows NSIS x64
installer; macOS/Linux bytes are hash-checked but their embedded metadata is not inspected.

### Recall a bad release

1. Stop publication and record the bad version, previous known-good tag, and affected users.
2. With the owner login, unset Latest on the bad feed release:
   `gh release edit vBAD -R stefandsl/filow-releases --latest=false`.
3. Explicitly repoint Latest to the previous known-good release:
   `gh release edit vGOOD -R stefandsl/filow-releases --latest`.
   Read the `/releases/latest/download/latest.yml` feed URL again and verify its version and
   hashes against that known-good release. Do not rely on GitHub's automatic Latest selection.
4. Withdraw the bad download by changing that release back to draft (or deleting it after
   preserving evidence). Recheck the feed pointer. Source releases and feed releases are
   separate: recalling only the source release does not recall the feed.
5. With `allowDowngrade: false`, clients already running BAD do not downgrade automatically.
   Clients that have not downloaded BAD see GOOD on the next check; an already downloaded
   update may still install on quit. Recall cannot erase local downloads or installed copies.
   Publish a fixed version strictly above BAD for recovery; arrange manual reinstall/support
   for affected clients, and test data compatibility before suggesting any manual downgrade.

### First paid release: manual installer upgrade gate

On a clean Windows VM, install the previous public installer, create realistic settings,
scripts and an account session, then install the candidate over it. Confirm one Installed
Apps entry, preserved settings/scripts/account state, working shortcuts and launch, About's
version/source commit, and an actual updater-driven upgrade. Repeat with a non-admin account;
record installer hashes, OS, results and screenshots in the release evidence. Signing,
SmartScreen and account/subscription flows require human acceptance, not just the smoke job.
Set `publisherName` to the exact certificate subject on the day the code-signing certificate
lands (owner item D6), then test signature verification and upgrade from the last unsigned
installer. Do not invent a publisherName before that decision.

What has to be true before Filow is offered to the public, and what is still open. Decisions that only
the owner can take are in docs/OWNER-DECISIONS.md; this file says what each one blocks. Started
2026-11-10 (feat-release track); platform details are in docs/PLATFORMS.md.

## Before any public release

| Item | State | Blocked by |
|---|---|---|
| Privacy policy in the app (About and privacy, offline) and in the repo (docs/PRIVACY.md, PRIVACY.it.md) | written from the code; the publisher's name, address, contact, report retention and supervisory authority are placeholders `[[...]]` | D33 |
| Children and classroom section of the policy confirmed by a legal adviser | placeholder in the policy | D33 |
| Problem reports | the app shows a masked report and sends nothing by itself; the user saves it to a file or presses "Open an issue on GitHub", which opens a public issue on the project's page (`SUPPORT` in apps/desktop/about.js), after a notice | done (GitHub issue #5) |
| Public link (Cloudflare) off by default or noticed | on by default, stated plainly in the policy | D31 |
| Phone mirror server on every network card | unchanged | D3 |
| One Filow per profile | done: a second launch brings the running window forward and starts nothing | - |
| Windows code signing | not signed | D6 |
| macOS signing, notarization, a Mac to test on | unsigned builds; the zip target for the updater is in the config | D7 |
| App ID still `com.intelliprompter.app` | unchanged on purpose; see below | D32 |
| Every `[[...]]` placeholder gone from docs/PRIVACY*.md | `grep -n "\[\[" docs/PRIVACY*.md` must print nothing | D33 |

## App ID (`com.intelliprompter.app`): what changing it would take

The app ID is `build.appId` in apps/desktop/package.json and `app.setAppUserModelId(...)` at the end of
apps/desktop/main.js. It is left from the Intelliprompter name. Users rarely see it (Windows shows the
product name "Filow"; on a Mac it shows in Activity Monitor and `defaults`). It is cheap to change before
the first signed and store release and expensive after. Nothing has been changed.

What depends on it, platform by platform:

| Where | What the ID does | What a change does | What it would take |
|---|---|---|---|
| Settings and data (all systems) | nothing: the config folder comes from the package name `@filow/desktop` (`%APPDATA%\@filow\desktop`), not from the app ID | settings, keys, script and models stay where they are | nothing |
| Windows installer (NSIS) | the uninstall registry key is a GUID made from the app ID: `01135e23-bb60-5e72-98b2-e306ae908617` (computed with electron-builder's UUID v5; not checked against an installed copy) | the next installer would not recognise the old install: two entries in "Installed apps", and the old uninstaller can delete the new files | set `build.nsis.guid` to the old GUID above in the same release, and test an upgrade from the last released installer |
| Windows taskbar, Start menu, notifications (AUMID) | `app.setAppUserModelId` and the shortcut the installer writes carry the ID | pinned taskbar icons stop matching the running app; notification settings the user changed are lost; jump lists reset | change both places together; the installer rewrites its shortcut; tell users to re-pin |
| Windows auto-update | electron-updater runs the new installer | works only with `nsis.guid` pinned (see above) | as above |
| Microsoft Store (MSIX), if chosen | the Store identity name is reserved in Partner Center, separate from the app ID | none for the Store itself | pick the Store identity when the listing is reserved |
| macOS bundle ID | the app ID is the bundle ID | macOS treats it as another app: Microphone, Screen Recording, Accessibility, Input Monitoring and Apple Events permissions must be granted again; the keychain asks again before Filow can read the item its saved keys are encrypted with; the updater (Squirrel.Mac) refuses an update whose code requirement changed, so users reinstall by hand | free today: macOS builds are unsigned and cannot auto-update anyway (D7). After the first signed release it costs every Mac user a manual reinstall and new permissions |
| Mac App Store, Google Play | the bundle ID / package name is fixed forever once a listing exists | cannot be changed after the first submission | decide before any store listing |
| Linux (AppImage, deb) | the deb package name comes from the package name; the desktop entry uses the product name | none expected | check the desktop entry and AppImage self-update once on a real Linux desktop |
| PowerPoint add-in | has its own ID in its manifest | none | nothing |

Options for the owner (D32):
1. Keep `com.intelliprompter.app` for good. Cost: none; the old name stays visible in a few technical places.
2. Change it now, before signing and stores: one release with the new ID, `nsis.guid` pinned to the old
   GUID, AUMID changed in the same release, an upgrade test from the last released Windows installer.
   macOS users of the unsigned builds reinstall (they would anyway once builds are signed).
3. Change it later: same work as option 2 plus a manual reinstall and new permissions for every signed
   macOS user, and impossible for any store listing that already exists.

## Release candidate checks (each release)

1. `npx vitest run`, `npm run typecheck`, `npm run lint` clean.
2. Package for Windows, launch it, open "About and privacy" with the network off: the policy shows.
3. Launch the packaged app twice on the same profile (same FILOW_USER_DATA_DIR and ports): the second
   process exits within a second or two with code 0, the ports stay with the first one, and the first
   window comes to the front.
4. "Report a problem": the report window lists everything, "Save to a file" writes it, and no browser opens.
5. The release notes say what changed in what Filow sends or keeps; if anything did, docs/PRIVACY*.md and
   docs/okfilow/OUTBOUND.md changed in the same release.

## Explicit account-origin gate

Only after the owner approves a live account release, pass `--require-account-origin <exact-HTTPS-origin>` to `tools/release/release-verify.mjs verify` (and any audit of that policy). Multiple approved origins can be comma-separated. This option requires installer metadata to contain an exact member of that list; absent origin fails. Without the option, existing behavior holds: absent origin passes and origins outside the default empty allowlist fail. An empty list, non-HTTPS URL, credentials, path, query or fragment is rejected. No production origin is configured by this change, and `release.ps1` does not yet forward this policy or set build metadata. Do not treat that wrapper as a live-account release gate until wired.

Offline policy fixture example (test hostname only):

```powershell
node tools/release/release-verify.mjs fixture --input tools/release/test/fixtures/good.json --require-account-origin https://accounts.example.test
```

This fixture intentionally fails because its installer has no account origin.
