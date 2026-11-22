# N-06 independent pilot freeze

Base a21db5ad9a08e081baa8cb6b04921eb5450404fe. Gemini 4 Neon High authored both private sets before implementation.

| UTF-8 payload | SHA-256 |
|---|---|
| Decision albums | 5a3978d89b3f78ba3a1fac7545adc9b7327bb1be224e42b60b4269e1c9320642 |
| Lesson topic and grading key | e1242221f16b27eed4d69f91bc3b8002537b0a36a19e0719a4f8936bff4850aa |

Each of EN, IT, JA, RO and RU has one development and three held-out speaker/album groups, with five reports per group. Score every held-out report once per route. Use two-sided Wilson 95% intervals for correct automatic decisions and clarification among clear reports and false ticks among negatives. A missed clear report remains in the denominator. Report unavailable routes separately. Require at least 80% correct automatic ticks, zero false ticks and at most 20% clarification per language. Use confirmation unless qualified.

Reference machine i9-13900KF (24 cores, 32 threads), 137182855168 bytes RAM, RTX 3070 with 8192 MiB VRAM. Use paced capture with deck active. Keep cold and warm attempts separate. Record timeouts at 60 seconds and misses. Latency targets await owner freeze. Do not select a model using the grading key or held-out labels.
