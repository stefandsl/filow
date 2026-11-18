## dev split, recognizer use: questions, norm-v1

| arm | clean | quiet | noisy_env_all | hard_env_snr0_5 | voice_same | voice_diff | echo | quiet dels | noise-only tokens |
|---|---|---|---|---|---|---|---|---|---|
| raw | 8.29 | 11.39 | 25.23 | 34.98 | 61.15 | 38.66 | 42.59 | - | 3 |
| gtcrn | 11.05 (+2.76; +1.11..+5.08) | 13.49 (+2.09; +0.50..+3.60) | 32.24 (+7.01; +4.83..+8.47) | 44.72 (+9.74; +5.94..+12.29) | 67.69 (+6.54; +1.72..+12.93) | 50.58 (+11.91; +4.94..+18.53) | 49.97 (+7.38; +1.80..+12.25) | 5.22 (+0.86) | 10 |

Per condition (macro error rate, percent):

| condition | raw | gtcrn |
|---|---|---|
| keyboard_snr0 | 39.48 | 44.32 |
| keyboard_snr5 | 18.56 | 22.88 |
| keyboard_snr10 | 10.91 | 16.52 |
| keyboard_snr20 | 18.26 | 20.47 |
| fan_snr0 | 21.51 | 34.17 |
| fan_snr5 | 14.09 | 16.90 |
| fan_snr10 | 16.90 | 19.49 |
| fan_snr20 | 7.68 | 11.00 |
| traffic_snr0 | 72.61 | 88.01 |
| traffic_snr5 | 42.21 | 60.28 |
| traffic_snr10 | 29.07 | 38.83 |
| traffic_snr20 | 9.79 | 10.82 |
| voice_same_sir0 | 82.35 | 89.05 |
| voice_same_sir12 | 40.68 | 47.24 |
| voice_diff_sir0 | 53.99 | 66.21 |
| voice_diff_sir12 | 23.61 | 34.82 |
| echo_sir0 | 58.85 | 67.10 |
| echo_sir12 | 26.53 | 32.95 |

Gates:

| arm | noisy: rel. reduction (>= 5 %, interval below 0) | clean: diff (<= +0.5) | slices > 1 pt worse (significant / all) | quiet deletions diff (<= +0.5) | noise-only tokens (<= raw) |
|---|---|---|---|---|---|
| gtcrn | FAIL -27.8 % (+4.83..+8.47 pt) | FAIL +2.76 | FAIL 17 / 74 | FAIL +0.86 | FAIL 10 vs 3 |
