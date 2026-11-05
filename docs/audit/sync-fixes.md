# Sync and stop fixes

2026-11-05, branch `fix/sync-and-stop`. One commit per reproduced bug; no push.
Each before run uses an ordinary `it` against production code without that fix.
Targeted runs select one test; their skipped counts are unselected tests, not expected failures.
TEMP, TMP and npm cache are under `G:\FILOW\tmp\sync-fixes`; GAUNTLET=0.
Direct DriveInfo check: C: has 423,912,194,048 available bytes (above 20 GB).
Existing untracked `tmp/` contents are preserved. AGENTS.md is unchanged.

## B01: stale relay patch must not roll the phone back through resync


### Fail before B01

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'stale relay patch must not roll the phone back through resync'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t stale relay patch must not roll the phone back through resync


 RUN  v5.1.0 G:/FILOW

 ❯ apps/server/src/seams.test.ts (7 tests | 1 failed | 6 skipped) 24ms
   ❯ Step 4 relay/client seams (7)
     × stale relay patch must not roll the phone back through resync 23ms
npm.cmd : 
In riga:2 car:212
+ ... $captured = & npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  apps/server/src/seams.test.ts > Step 4 relay/client seams > stale relay patch must not roll the phone back 
through resync
AssertionError: stale patch must preserve section 2: expected 1 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 1

 ❯ apps/server/src/seams.test.ts:103:78
    101|     expect(f.phone.state?.sectionIdx).toBe(2);
    102|     patch(f.engine, 1, 1); await settle();
    103|     expect(f.phone.state?.sectionIdx, "stale patch must preserve secti…
       |                                                                              ^
    104|   });
    105|   // Contract: ARCHITECTURE.md §5.4 version = previous + 1; duplicate …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 6 skipped (7)
   Start at  19:46:04
   Duration  514ms (import 57%, transform 36%, tests 6%, worker 1%)

Exit code: 1
```

### Pass after B01

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'stale relay patch must not roll the phone back through resync'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t stale relay patch must not roll the phone back through resync


 RUN  v5.1.0 G:/FILOW


 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
   Start at  19:46:21
   Duration  257ms (transform 46%, import 40%, tests 11%, worker 2%)

Exit code: 0
```
