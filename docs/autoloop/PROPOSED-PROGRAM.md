# Proposed changes to program.md and the checks (daily review decides)

- CR-02 check is too weak: it passes when the string render-process-gone appears anywhere. Replace with a CDP probe: crash the main page, the page must be back within 3 s.
- Add a check that GrantFileProtocolExtraPrivileges can be turned off: move splash, welcome and picker from file:// to a custom protocol (protocol.handle), then flip the fuse.
- SEC-1 counts webPreferences blocks; windows created by other modules (okfilow.js) are owned by another session, so the score cannot reach 100 until that session lands its part.

## 2026-11-09 (scheduled run)
- Two loops ran at the same time: the scheduled run and the interactive "Filow repository access" session both work this queue and edit main.js. Proposal: a lock file `tmp/autoloop/LOCK` (session name, start time, files in hand) written at the start of an experiment and removed at the end; a run that finds a fresh lock picks only items outside its files.
- Add an I18N-01 automatic check (weight 3) to standards.json that runs `npx vitest run packages/core/src/i18n.test.ts`. Note: it passes today, so by the section 5.3 rule it measures nothing until it also covers buddy/text.ts and the inline main.js strings. Better: a check script that fails while those tables have no parity test.
- Create `docs/autoloop/MANUAL.md`: the stop condition needs it, and it does not exist yet.
