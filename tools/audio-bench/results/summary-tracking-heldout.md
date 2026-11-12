## heldout split, recognizer use: tracking, norm-v1

| arm | clean | quiet | noisy_env_all | hard_env_snr0_5 | voice_same | voice_diff | echo | quiet dels | noise-only tokens |
|---|---|---|---|---|---|---|---|---|---|
| raw | 12.28 | 14.76 | 22.14 | 28.51 | 63.63 | 48.97 | 45.24 | - | 1 |
| dpdfnet2 | 13.56 (+1.28; -0.03..+3.09) | 15.77 (+1.01; -0.35..+2.19) | 21.14 (-0.99; -2.81..+0.77) | 25.99 (-2.52; -5.13..+0.00) | 68.18 (+4.56; +0.13..+8.81) | 54.41 (+5.43; +2.03..+9.55) | 51.30 (+6.06; +1.48..+12.11) | 4.85 (+0.30) | 0 |

Per condition (macro error rate, percent):

| condition | raw | dpdfnet2 |
|---|---|---|
| keyboard_snr0 | 35.21 | 27.74 |
| keyboard_snr5 | 30.56 | 22.29 |
| keyboard_snr10 | 20.56 | 18.88 |
| keyboard_snr20 | 13.92 | 14.35 |
| fan_snr0 | 22.04 | 23.00 |
| fan_snr5 | 18.83 | 16.02 |
| fan_snr10 | 14.22 | 15.76 |
| fan_snr20 | 10.60 | 12.43 |
| traffic_snr0 | 36.31 | 39.54 |
| traffic_snr5 | 26.44 | 26.61 |
| traffic_snr10 | 18.96 | 20.08 |
| traffic_snr20 | 17.36 | 17.01 |
| voice_same_sir0 | 81.64 | 87.57 |
| voice_same_sir12 | 44.82 | 47.89 |
| voice_diff_sir0 | 74.75 | 77.93 |
| voice_diff_sir12 | 24.24 | 31.78 |
| echo_sir0 | 60.79 | 64.28 |
| echo_sir12 | 28.89 | 37.90 |

Gates:

| arm | noisy: rel. reduction (>= 5 %, interval below 0) | clean: diff (<= +0.5) | slices > 1 pt worse (significant / all) | quiet deletions diff (<= +0.5) | noise-only tokens (<= raw) |
|---|---|---|---|---|---|
| dpdfnet2 | FAIL +4.5 % (-2.81..+0.77 pt) | FAIL +1.28 | FAIL 8 / 52 | PASS +0.30 | PASS 0 vs 1 |

Speaker isolation gate (competing voice, same and other language pooled): relative reduction >= 5 % with the interval below 0:

- dpdfnet2: FAIL raw 56.24 -> 61.21 (-8.8 %; +1.61..+8.19 pt)
