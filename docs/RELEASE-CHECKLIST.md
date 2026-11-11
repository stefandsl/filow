# Release checklist

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
