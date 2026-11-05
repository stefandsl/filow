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

### B02 — Fail before: duplicate non-idempotent patch must not be applied twice by relay

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'duplicate non-idempotent patch must not be applied twice by relay'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t duplicate non-idempotent patch must not be applied twice by relay


 RUN  v5.1.0 G:/FILOW

 ❯ apps/server/src/seams.test.ts (7 tests | 1 failed | 6 skipped) 26ms
   ❯ Step 4 relay/client seams (7)
     × duplicate non-idempotent patch must not be applied twice by relay 25ms
npm.cmd :
In riga:2 car:212
+ ... $captured = & npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  apps/server/src/seams.test.ts > Step 4 relay/client seams > duplicate non-idempotent patch must not be applied
twice by relay
AssertionError: one version must append the fact once: expected [ 'one fact', 'one fact' ] to deeply equal [ 'one
fact' ]

- Expected
+ Received

  [
    "one fact",
+   "one fact",
  ]

 ❯ apps/server/src/seams.test.ts:118:81
    116|     expect(f.phone.state?.unmentioned).toEqual(["one fact"]);
    117|     f.engine.publishPatch(1, ops); await settle();
    118|     expect(f.phone.state?.unmentioned, "one version must append the fa…
       |                                                                                 ^
    119|   });
    120|   it("a phone-only reconnect replays missed patches folded into a full…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 6 skipped (7)
   Start at  19:46:48
   Duration  256ms (transform 45%, import 35%, tests 17%, worker 2%)

Exit code: 1
```

### Pass after B02

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'duplicate non-idempotent patch must not be applied twice by relay'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t duplicate non-idempotent patch must not be applied twice by relay


 RUN  v5.1.0 G:/FILOW


 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
   Start at  19:47:03
   Duration  259ms (transform 45%, import 41%, tests 11%, worker 2%)

Exit code: 0
```

### B03 — Fail before: engine reconnect must resend state changed while disconnected

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'engine reconnect must resend state changed while disconnected'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t engine reconnect must resend state changed while disconnected


 RUN  v5.1.0 G:/FILOW

 ❯ apps/server/src/seams.test.ts (7 tests | 1 failed | 6 skipped) 21ms
   ❯ Step 4 relay/client seams (7)
     × engine reconnect must resend state changed while disconnected 20ms
System.Management.Automation.RemoteException
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
System.Management.Automation.RemoteException
 FAIL  apps/server/src/seams.test.ts > Step 4 relay/client seams > engine reconnect must resend state changed while disconnected
AssertionError: reconnect must publish the current transcript without waiting for another change: expected undefined to be 'missed during disconnect' // Object.is equality
System.Management.Automation.RemoteException
- Expected:
"missed during disconnect"
System.Management.Automation.RemoteException
+ Received:
undefined
System.Management.Automation.RemoteException
 ❯ apps/server/src/seams.test.ts:143:91
    141|     const reconnected = runtime.clients[1] as FakeSocket;
    142|     expect(reconnected.sent.find(m => m.t === "state")?.state.transcri…
    143|       "reconnect must publish the current transcript without waiting f…
       |                                                                                           ^
    144|   });
    145|   // Contract: ARCHITECTURE.md §5.4 contiguous versions and Q2 converg…
System.Management.Automation.RemoteException
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
System.Management.Automation.RemoteException

 Test Files  1 failed (1)
      Tests  1 failed | 6 skipped (7)
   Start at  19:47:24
   Duration  216ms (transform 44%, import 36%, tests 17%, worker 3%)

Exit code: 1
```

### Pass after B03

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'engine reconnect must resend state changed while disconnected'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t engine reconnect must resend state changed while disconnected


 RUN  v5.1.0 G:/FILOW


 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
   Start at  19:47:43
   Duration  231ms (transform 42%, import 39%, tests 16%, worker 3%)

Exit code: 0
```

### B04 — Fail before: relay must request full state when engine skips a patch version

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'relay must request full state when engine skips a patch version'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t relay must request full state when engine skips a patch version


 RUN  v5.1.0 G:/FILOW

 ❯ apps/server/src/seams.test.ts (7 tests | 1 failed | 6 skipped) 21ms
   ❯ Step 4 relay/client seams (7)
     × relay must request full state when engine skips a patch version 20ms
System.Management.Automation.RemoteException
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
System.Management.Automation.RemoteException
 FAIL  apps/server/src/seams.test.ts > Step 4 relay/client seams > relay must request full state when engine skips a patch version
AssertionError: relay must request the missing base instead of blessing an incomplete snapshot: expected "vi.fn()" to be called once, but got 0 times
 ❯ apps/server/src/seams.test.ts:149:102
    147|     const f = await fixture(); const resync = vi.fn(); f.engine.onResy…
    148|     patch(f.engine, 2, 2); await settle();
    149|     expect(resync, "relay must request the missing base instead of ble…
       |                                                                                                      ^
    150|   });
    151|   it("characterizes a fresh relay: the prior process's pairing code no…
System.Management.Automation.RemoteException
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
System.Management.Automation.RemoteException

 Test Files  1 failed (1)
      Tests  1 failed | 6 skipped (7)
   Start at  19:48:03
   Duration  221ms (transform 44%, import 36%, tests 17%, worker 3%)

Exit code: 1
```

### Pass after B04

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' '-t' 'relay must request full state when engine skips a patch version'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts -t relay must request full state when engine skips a patch version


 RUN  v5.1.0 G:/FILOW


 Test Files  1 passed (1)
      Tests  1 passed | 6 skipped (7)
   Start at  19:48:24
   Duration  261ms (transform 48%, import 38%, tests 12%, worker 2%)

Exit code: 0
```

### Sync regression checks after B04

Command: `npm.cmd 'test' '--' 'apps/server/src/seams.test.ts' 'apps/server/src/server.test.ts' 'packages/client'`

```text

> filow-monorepo@0.9.28 test
> vitest run apps/server/src/seams.test.ts apps/server/src/server.test.ts packages/client


 RUN  v5.1.0 G:/FILOW


 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  19:48:32
   Duration  444ms (tests 62%, import 24%, transform 13%, worker 1%)

Exit code: 0
```
