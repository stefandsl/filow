# Faster answers, first run and accounts

Implementation branch: `feat/fast-onboarding-account`.

## Decisions

- Keep Electron, the existing Filo colours, type, controls and language preferences.
- Start speech at completed sentences and screen highlights at validated tags. Keep one cancellable queue per answer. Do not promise faster model generation without measurement.
- Bundle an original short, captioned video so the introduction also works offline. No remote player or tracking.
- Follow the video with explicit practice: a real native overlay around a practice target, then an optional real AI question through the existing screenshot and outbound-consent flow. Label the guided overlay accurately; it is not model inference.
- Keep local use available without an account. Account and billing run in a separate hosted service; provider and Stripe secrets never ship in the desktop app.
- Sign-in uses a browser/device approval flow. Subscription access is determined by the service, not a successful browser redirect.
- Test payments first. A real domain, email delivery, Stripe price and webhook configuration are deployment inputs.

## Visual direction

Use Filo's existing theme tokens, wordmark and button shapes. One main action per step; visible skip/back controls. Respect reduced motion. The original brief and the existing welcome are the visual references; the design reference connector was unavailable. A restrained product walkthrough suits the app better than introducing a second visual system.

## Verification

- Full suite: 176 test files passed, 2,185 tests passed; 2 files / 5 tests skipped by the existing suite. Typecheck and lint passed.
- Final production builds passed for web, relay, PowerPoint and browser extension, plus desktop welcome and hosted account UI. Existing bundle-size and Next ESLint-plugin notices remain; no build errors. The generated PowerPoint manifest ID was restored so it is not part of this change.
- Account integration tests run against a real in-memory SQLite database and the actual Better Auth endpoints. They exercise email code sign-in, explicit device review/approval, one-time token redemption and rejection of unknown clients.
- Stripe HTTP calls are mocked. The actual plugin creates checkout with the configured price, verifies signed webhook fixtures, handles repeated delivery, enables an active subscription and removes access for `past_due`. Invalid signatures do not enable access. Real Stripe merchant/webhook acceptance is still required.
- Desktop tests cover encrypted token storage boundaries, cancellation during an in-flight poll, polling backoff, expiry and exact account/Stripe URL restrictions. The encryption primitive is mocked in unit tests; production uses Electron safeStorage.
- On Windows, ran a separate Electron profile on G:, ports 4799/4800/4801, with a fake microphone. Completed the welcome, played the video (17.96 seconds, no playback error), confirmed it pauses on leaving the step, and reached `/tour` automatically. The native mark appeared in one of the two monitor overlays, not both.
- Inspected welcome, intro, tour and account screens, including dark/light tour and account. Inspected the hosted sign-in page in Italian, dark/light and at mobile width. The desktop account page's automated WCAG A/AA scan reported no violations. The hosted page's CSP blocked test-script injection, so no automated accessibility pass is claimed for that page.
- Intro assets: MP4 71,007 bytes, poster 48,858 bytes, captions 267 bytes. Manual playback only; the translated transcript remains readable without the video.
- Rechecked the rebuilt Windows app: the first practice mark reaches an overlay after its readiness handshake (monitor counts `[1,0]`). Browser-only account fixtures verified the Subscribe action, sign-out and displayed device code without creating a real account or charge. These UI fixtures are separate from the real auth/plugin integration tests above.
- No installer was signed, installed or published. No production account, actual email delivery, live payment or cloud AI entitlement enforcement was configured. The real assistant-question button uses the existing model route and permissions; no real-model latency benchmark or unattended task-success claim is made.

Run/setup instructions: `apps/cloud/README.md`. Existing local functions do not require an account.
