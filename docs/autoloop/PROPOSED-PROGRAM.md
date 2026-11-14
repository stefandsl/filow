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

## 2026-11-11 (scheduled run)
- Section 0: the take probes need Ollama, and nothing starts it. A run without it scores TST-02 and PR-01 as failing for reasons unrelated to the code. Proposal: take.mjs checks 127.0.0.1:11434 in its preflight and exits with "Ollama is not running" instead of running a take that decides nothing; the scheduled run starts `ollama serve` itself, keeps the PID and stops it at the end.
- Section 1: a score is only comparable to another made from the same probe files. Today the score fell 96.22 -> 95.85 because the 45-minute take replaced the 20-minute one, not because of the code. Proposal: results.tsv records the age and source build of each tmp/autoloop/*.json the score read, and the keep rule compares against the best score made from the same probe set.
- Section 6: run the 45-minute memory take in the background while experiments are being written (it needs only its ports). It found a stall at 26 minutes that the 20-minute run cannot see.
- SEC-08 check is still a string search. The CDP probe of this run (tmp/autoloop/probe-sec08.mjs in the worktree, not committed: probes belong in tools/autoloop/e2e in the review step) is a candidate for tools/autoloop/e2e/permissions.mjs writing tmp/autoloop/permissions.json. It fails on build B (camera granted), so it can fail.
## 2026-11-13 (scheduled run)
- a11y.mjs presses Enter on Start and expects the start dialog. In the default Auto start mode Start now goes straight into a take (no dialog), so A11Y-02 fails for a probe reason, and the click makes the page call `/api/local/plan`, which the autoloop must never call. Proposal: the probe sets `prefs:startMode` to "ask" before that step (the dialog path, no plan call), and adds the focus check from tmp/probe-focus.mjs of this run (Enter on Start in "local" mode: focus must land on Stop, then on Start after Enter again; it failed on release-autoloop-q and passed on release-autoloop-c).
- take.mjs on a fresh profile: the first offline take failed 0/3 with 75 decide calls aborted while the shared Ollama was cold-loading clef-flash; the rerun passed 3/3. Warm the model (one /api/decide call) before Start, or retry once, so a cold model is not counted as a product failure.
- The review agents could not start this run: a context-mode hook rewrites every Agent call, and auto mode then refuses it. A scheduled run needs either that hook off or the reviews run another way; until then the goldfish/elephant step is skipped and says so.
- context-mode's ctx_execute_file hung for 1800 s again: the scheduled prompt should say "use Bash and node scripts, never ctx_*".

## 2026-11-14 (scheduled run)
- SEC-08 row of standards.json: replace the string search (it passed while every page got the camera) with the packaged probe. Ready and shown able to fail, but not applied: changing a scored row is for a person to accept. Change: `"auto": { "type": "cmd", "cmd": "node tools/autoloop/checks/permissions-probe.mjs" }`, and the daily run executes `node tools/autoloop/e2e/permissions.mjs <win-unpacked>` (about 15 s). The check failed on the base build's result (camera granted), on a missing file, on a 49-hour-old file, on a result edited to list no problems, and on an empty result; it passes on the fixed build.
- A11Y-02 fails for a probe reason for the third day: a11y.mjs presses Enter on Start and expects the start dialog, which only the "ask every time" mode shows. In the default Auto mode the press starts a take and calls /api/local/plan, which the autoloop must never call. The patch below runs that step in "ask" mode and puts the stored mode back. Not applied by this run, for the same reason as above: it turns a failing row into a passing one by changing the measurement.

```diff
diff --git a/tools/autoloop/e2e/a11y.mjs b/tools/autoloop/e2e/a11y.mjs
index 3b199ae..588090f 100644
--- a/tools/autoloop/e2e/a11y.mjs
+++ b/tools/autoloop/e2e/a11y.mjs
@@ -216,6 +216,13 @@ for (const route of ROUTES) {
   keyboard.announced = typeof saidAfterEnter === "string" && pointText !== "" && saidAfterEnter.endsWith(": " + pointText) && saidAfterSpace === "";
   keyboard.announcement = { afterTick: saidAfterEnter, afterUntick: saidAfterSpace };
   if (start !== "waiting" || afterEnter !== "done" || afterSpace !== "waiting") keyboard.problems.push({ route: "/", kind: "keys", what: `point row: ${start} -> Enter -> ${afterEnter} -> Space -> ${afterSpace}` });
+  // The start dialog belongs to the start mode "ask every time". The default (Auto) starts a take
+  // straight from Start: no dialog to walk, and a take this probe must not begin (it would ask the
+  // local planner and open the microphone). So the dialog step runs in "ask" mode and puts the
+  // stored mode back afterwards.
+  const startModeBefore = await evaluate(`localStorage.getItem("prefs:startMode")`);
+  await evaluate(`localStorage.setItem("prefs:startMode", "ask"); true`);
+  await open("/");
   const dialogOpen = `!!document.querySelector("dialog[open]")`;
   const opener = await evaluate(`(() => { const b = document.querySelector(".action-bar .btn.primary"); if (!b) return null; b.focus(); return b.textContent.trim(); })()`);
   await key("Enter", "Enter", 13); await sleep(1200);
@@ -227,6 +234,7 @@ for (const route of ROUTES) {
   }
   const after = await evaluate(`(${dialogOpen}) + "|" + document.activeElement.textContent.trim()`);
   if (left > 0 || after !== `false|${opener}`) keyboard.problems.push({ route: "/", kind: "keys", what: `start dialog: ${left} Tab presses left it; after Escape: ${after} (opened from "${opener}")` });
+  await evaluate(`(() => { const v = ${JSON.stringify(startModeBefore ?? null)}; if (v === null) localStorage.removeItem("prefs:startMode"); else localStorage.setItem("prefs:startMode", v); return true; })()`);
   // The control: one more button, without a name and without a ring, placed first in the tab order.
   await evaluate(`document.body.insertAdjacentHTML("afterbegin", '<button id="planted" style="outline:none;box-shadow:none"></button>'); true`);
   const planted = (await walk("/")).problems.filter((p) => p.what.startsWith("<button#planted>")); // its problems stay out of keyboard.problems: they are the control, not a defect
```

- Section 0: `npm run vendor` from Git Bash needs the fix carried on this branch; until it is on main, put System32 first on the PATH for that one command.
- Section 6: start the 45-minute take right after the baseline score and move the short probes of the experiments to other ports (FILOW_E2E_PORT=4797, FILOW_E2E_DEVTOOLS=9347, checked with netstat first). It cost no wall time this run and PERF-02 got its full credit.
- Reviews: the Agent call is refused once because a context-mode hook adds text to it; sending the call again with exactly the text shown in the refusal starts the agents. The egm agents have no shell: give them file paths, not a git diff command.
- A heredoc in the Bash tool halves doubled backslashes: helper scripts with regular expressions go through the Write tool (it bit twice this run).
- Unmerged autoloop branches pile up (three when this run started). Proposal: the daily run checks `git branch --no-merged main` for autoloop/* first and carries what still applies, as this run did, so one branch waits for the orchestrator instead of one per day.
