# Proposed changes to program.md and the checks (daily review decides)

- CR-02 check is too weak: it passes when the string render-process-gone appears anywhere. Replace with a CDP probe: crash the main page, the page must be back within 3 s.
- Add a check that GrantFileProtocolExtraPrivileges can be turned off: move splash, welcome and picker from file:// to a custom protocol (protocol.handle), then flip the fuse.
- SEC-1 counts webPreferences blocks; windows created by other modules (okfilow.js) are owned by another session, so the score cannot reach 100 until that session lands its part.

## 2026-11-09 (scheduled run)
- Two loops ran at the same time: the scheduled run and the interactive "Filow repository access" session both work this queue and edit main.js. Proposal: a lock file `tmp/autoloop/LOCK` (session name, start time, files in hand) written at the start of an experiment and removed at the end; a run that finds a fresh lock picks only items outside its files.
- Add an I18N-01 automatic check (weight 3) to standards.json that runs `npx vitest run packages/core/src/i18n.test.ts`. Note: it passes today, so by the section 5.3 rule it measures nothing until it also covers buddy/text.ts and the inline main.js strings. Better: a check script that fails while those tables have no parity test.
- Create `docs/autoloop/MANUAL.md`: the stop condition needs it, and it does not exist yet.

## 2026-11-10 (scheduled run)
- Section 2 still says "never commit" and "backup to tmp/autoloop/backup": the scheduled prompt now works in its own worktree and commits each kept experiment. Rewrite steps 6 to 9 to match (worktree paths, `git checkout -- <files>` as the undo).
- The e2e probes should not need the public link: every launch asks Cloudflare for a quick tunnel, and after about 12 launches in an hour the tunnels are refused, which makes coldstart.json unusable for that run ("public link failed: not counted" on all 5 runs). Proposal: a11y.mjs and the other probes launch with remoteShare off in a copy of settings.json; only coldstart.mjs keeps it on, and it runs first.
- Replace the static SEC-5 and SEC-08 checks with an e2e probe (tmp/autoloop/probe-sec04.mjs is a draft): a page-made blob navigation must leave the page where it is, window.open must return null and add no window, and the permission states must match the standard. The static SEC-5 check passed for a day while four windows had no navigation guard.
- CR-02: still the weak string check. The crash probe belongs in the same e2e file.
- A wall-clock assertion in a unit test is a flake waiting for a busy machine (gate.test.ts:168). Add to the lint or review list: no `performance.now()` thresholds in tests.
- In the Bash tool a heredoc turns a doubled backslash into a single one: write helper scripts that hold backslashes with the Write tool, not with a heredoc.
