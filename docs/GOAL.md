# Filow goal and operating notes

See [VISION.md](VISION.md) for the product goal, [PLAN.md](PLAN.md) for delivery and [METHODOLOGY.md](METHODOLOGY.md) for the work and review process.

## Standing operating rules

- Local first: no silent cloud fallback, no paid API calls in tests, no telemetry by default.
- Keep caches, profiles and test data on the workspace volume. Configure npm to use a cache on that volume.
- No push, tag or release without the owner. No em dash in any text. No co-author lines.
- Kill only processes you started (by PID, `taskkill /PID <pid> /T /F`), never by image name.

- Changes to the machine outside this repo and skills whose scan is above LOW require the owner.

Platform acceptance means a build installed and checked on the platform. Android and iOS use the web companion for pairing and remote use. See [platform evidence](PLATFORMS.md).

Historical acceptance criteria and measurements remain in [tracking and hardening](PRODUCTION-PLAN.md), [OK Filow](OKFILOW-GAUNTLET.md) and the [journal](autoloop/JOURNAL.md).
