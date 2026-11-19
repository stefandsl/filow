# Factory brief for one assignment

Read `docs/REVIEW.md` first. The coordinator fills in one private copy per assignment, includes only the assigned role or reviewer stage below and resolves every placeholder before dispatch. Use a clean session for each reviewer packet.

| Field | Fill in before starting |
|---|---|
| Ticket and goal | `<PLAN ticket ID>`, `<person, action and visible result>` |
| Assignment | `<role, factory verb, run ID, provider, flagship model, reasoning effort and session ID>`. Choose medium, high or xhigh. Never use max effort or fast mode. |
| Worktree and branch | `<assigned checkout and branch, full base SHA>`. On replay include the full candidate SHA. For the blind packet give only the isolated review workspace. |
| Output folder | `<private folder for this assignment>` |
| Only paths this role may write | `<each report and scratch path inside the output folder>`. For a builder also list each permitted path in the worktree, including `docs/REVIEW.md` for a bug fix. Forbid all other writes, including to the shared checkout and other worktrees. |
| Permissions and limits | `<allowed operations, targets and data>`, `<time, retries and tool-call limits>`, `<timeout per command>`. Plan, build and verify end locally. |
| Inputs and checks | `<trusted inputs>`, `<positive and negative examples>`, `<applicable review rule IDs, checks and who runs each>`, `<risk and reason>`, `<reserved round out of three for review>` |
| Setup and evidence | `<CI preparation>`, `<private temp, cache and test profile>`, `<provider ready or missing>`, `<required observations, commands and report path>` |

Act without questions. Stop the affected step and report HOLD if a path or grant is unclear, setup fails, a secret appears, a required check stays red or a limit expires. Keep secrets out of briefs, command lines, logs and reports. Give checkout scripts and tests no provider or publish credentials.

**Builder.** Inspect the entry point, callers and nearby tests. Reproduce a bug on the base, make the scoped fix and replay both examples. Record changed files and the applicable checks. Include the new review rule in the fix commit. After interruption, compare the saved gate intent with the receipt before repeating a command. Check both the recovered case and a fresh successful invocation.

**Reviewer, blind case.** Start outside the candidate with the pre-change review rules, goal, examples and limits. Write a different failure case with its input and expected result. End the assignment. The coordinator records the case digest and time before sharing any candidate paths, revisions, tests or findings.

**Reviewer, replay.** Open the pinned diff read-only, check the case digest and run it along with the frozen examples and applicable rules. Record this packet's assignment ID, the exact candidate and the sealed case digest in the reply. If a reply belongs to an earlier dispatch, preserve it and replay the current assignment. For each finding give severity, file and line, steps, expected result and observation. List missing proof.

**Judge.** Use a fresh, read-only session and the [verification rules](../METHODOLOGY.md#who-builds-and-who-reviews). Check independence, the actual risk and each receipt. Rehash any package at its recorded path, including after a restart, and match the reviewer's digest. Replay disputed findings. Give local PASS only for a candidate with every required check satisfied. Otherwise give HOLD and the next action. Stop after three review rounds, including rechecks.

**Report.** Record the assignment identity. For each executed gate give the tested SHA, command, working directory, times, exit code and expected and observed results. The blind report contains only the independent case and its receipt. For native claims include the package digest, device and OS. Keep full evidence private. Reply in 60 words or fewer with the result, receipt location and any unverified claim.
