| engine | machine | threads | state | hop ms | p50 / p95 / p99 / max ms per hop | RTF | CPU % of one core | memory added MiB | machine CPU % | recognizer ran to the end |
|---|---|---|---|---|---|---|---|---|---|---|
| dfn3 | this PC | 1 | alone | 10.0 | - / - / - / - | 0.1032 | 10.1 | 45.5 | 53 | - |
| dfn3 | this PC | 1 | asr-running | 10.0 | - / - / - / - | 0.1190 | 11.8 | 38.1 | 70 | yes |
| dfn3 | 4 efficiency cores | 1 | alone | 10.0 | - / - / - / - | 0.1562 | 15.3 | 38.0 | 56 | - |
| dfn3 | 4 efficiency cores | 1 | asr-running | 10.0 | - / - / - / - | 0.2008 | 10.3 | 38.9 | 43 | yes |
| rnnoise | this PC | 1 | alone | 10.0 | 0.307 / 0.448 / 0.818 / 6.128 | 0.0341 | 3.4 | 15.2 | 34 | - |
| rnnoise | this PC | 1 | asr-running | 10.0 | 0.292 / 0.405 / 0.666 / 4.511 | 0.0320 | 3.2 | 15.0 | 45 | yes |
| rnnoise | 4 efficiency cores | 1 | alone | 10.0 | 0.625 / 1.266 / 4.184 / 17.149 | 0.0788 | 7.9 | 15.4 | 28 | - |
| rnnoise | 4 efficiency cores | 1 | asr-running | 10.0 | 0.649 / 1.395 / 18.129 / 157.426 | 0.1221 | 12.2 | 15.4 | 38 | yes |
| gtcrn | this PC | 1 | alone | 16.0 | 0.653 / 0.910 / 1.324 / 4.611 | 0.0443 | 4.4 | 35.1 | 26 | - |
| gtcrn | this PC | 2 | alone | 16.0 | 0.687 / 1.299 / 1.590 / 2.593 | 0.0489 | 9.7 | 35.2 | 32 | - |
| gtcrn | this PC | 1 | asr-running | 16.0 | 0.761 / 1.496 / 1.666 / 2.755 | 0.0602 | 6.0 | 34.1 | 47 | yes |
| gtcrn | 4 efficiency cores | 1 | alone | 16.0 | 1.218 / 1.849 / 4.469 / 15.691 | 0.0872 | 8.0 | 35.1 | 26 | - |
| gtcrn | 4 efficiency cores | 1 | asr-running | 16.0 | 1.369 / 7.277 / 11.345 / 24.285 | 0.1678 | 8.5 | 34.6 | 32 | yes |
| dtln | this PC | 1 | alone | 8.0 | 0.367 / 0.525 / 0.760 / 4.197 | 0.0473 | 4.7 | 35.4 | 23 | - |
| dtln | this PC | 2 | alone | 8.0 | 0.342 / 0.431 / 0.557 / 2.572 | 0.0426 | 12.9 | 35.7 | 30 | - |
| dtln | this PC | 1 | asr-running | 8.0 | 0.384 / 0.474 / 0.625 / 2.301 | 0.0509 | 5.2 | 34.4 | 44 | yes |
| dtln | 4 efficiency cores | 1 | alone | 8.0 | 0.358 / 0.898 / 3.594 / 15.819 | 0.0627 | 5.0 | 34.9 | 22 | - |
| dtln | 4 efficiency cores | 1 | asr-running | 8.0 | 0.358 / 2.695 / 6.511 / 25.075 | 0.0960 | 5.3 | 35.2 | 29 | yes |
| hush | this PC | 1 | alone | 10.0 | 0.484 / 0.652 / 0.914 / 21.895 | 0.0504 | 5.1 | 41.8 | 28 | - |
| hush | this PC | 1 | asr-running | 10.0 | 0.511 / 0.849 / 1.210 / 29.607 | 0.0558 | 5.6 | 40.2 | 49 | yes |
| hush | 4 efficiency cores | 1 | alone | 10.0 | 0.467 / 1.386 / 3.764 / 28.846 | 0.0639 | 5.4 | 40.9 | 26 | - |
| hush | 4 efficiency cores | 1 | asr-running | 10.0 | 0.603 / 4.894 / 11.715 / 80.310 | 0.1502 | 7.8 | 40.0 | 49 | yes |
| dpdfnet2 | this PC | 1 | alone | 10.0 | 2.919 / 3.809 / 4.307 / 13.987 | 0.3003 | 29.8 | 45.3 | 35 | - |
| dpdfnet2 | this PC | 2 | alone | 10.0 | 2.250 / 3.019 / 3.354 / 5.074 | 0.2352 | 46.9 | 46.5 | 34 | - |
| dpdfnet2 | this PC | 1 | asr-running | 10.0 | 3.246 / 3.984 / 4.477 / 8.919 | 0.3338 | 33.2 | 45.9 | 50 | yes |
| dpdfnet2 | 4 efficiency cores | 1 | alone | 10.0 | 2.870 / 4.588 / 6.892 / 53.447 | 0.3116 | 28.8 | 46.1 | 35 | - |
| dpdfnet2 | 4 efficiency cores | 1 | asr-running | 10.0 | 5.162 / 11.677 / 16.341 / 78.361 | 0.5981 | 32.2 | 44.8 | 47 | yes |
| dfn3_ll | this PC | 1 | alone | 10.0 | - / - / - / - | 0.2909 | 28.6 | 167.4 | 26 | - |
| dfn3_ll | this PC | 1 | asr-running | 10.0 | - / - / - / - | 0.4536 | 44.9 | 150.3 | 53 | yes |
| dfn3_ll | 4 efficiency cores | 1 | alone | 10.0 | - / - / - / - | 0.6038 | 55.4 | 165.9 | 25 | - |
| dfn3_ll | 4 efficiency cores | 1 | asr-running | 10.0 | - / - / - / - | 1.1007 | 53.2 | 151.1 | 42 | yes |
| dpdfnet2_48k | this PC | 1 | alone | 10.0 | 2.613 / 4.686 / 5.043 / 6.844 | 0.2977 | 29.6 | 47.0 | 37 | - |
| dpdfnet2_48k | this PC | 2 | alone | 10.0 | 2.410 / 3.898 / 4.273 / 5.306 | 0.2634 | 52.5 | 47.0 | 42 | - |
| dpdfnet2_48k | this PC | 1 | asr-running | 10.0 | 4.278 / 5.151 / 5.748 / 12.013 | 0.4171 | 41.3 | 46.8 | 58 | yes |
| dpdfnet2_48k | 4 efficiency cores | 1 | alone | 10.0 | 3.954 / 4.881 / 5.501 / 18.219 | 0.4089 | 40.0 | 47.3 | 36 | - |
| dpdfnet2_48k | 4 efficiency cores | 1 | asr-running | 10.0 | 4.596 / 18.023 / 39.719 / 138.315 | 0.7482 | 42.0 | 47.3 | 44 | yes |

Gates on: this PC

| engine | latency ms | added delay p95 ms (worst state) | CPU % (1 thread, alone) | memory MiB | p99 under 80 % of hop | RTF with recognizer | light mode | quality mode |
|---|---|---|---|---|---|---|---|---|
| dfn3 | 40 | 40.0 (no per-hop timing: latency only) | 10.1 | 46 | not measured (-) | 0.119 | PASS | PASS |
| rnnoise | 30 | 30.4 | 3.4 | 15 | yes (0.818) | 0.032 | PASS | PASS |
| gtcrn | 32 | 33.5 | 4.4 | 35 | yes (1.666) | 0.060 | PASS | PASS |
| dtln | 32 | 32.5 | 4.7 | 36 | yes (0.76) | 0.051 | PASS | PASS |
| hush | 20 | 20.8 | 5.1 | 42 | yes (1.21) | 0.056 | PASS | PASS |
| dpdfnet2 | 60 | 64.0 | 29.8 | 46 | yes (4.477) | 0.334 | FAIL | PASS |
| dfn3_ll | 20 | 20.0 (no per-hop timing: latency only) | 28.6 | 167 | not measured (-) | 0.454 | FAIL | PASS |
| dpdfnet2_48k | 60 | 65.2 | 29.6 | 47 | yes (5.748) | 0.417 | FAIL | PASS |

Gates on: 4 efficiency cores

| engine | latency ms | added delay p95 ms (worst state) | CPU % (1 thread, alone) | memory MiB | p99 under 80 % of hop | RTF with recognizer | light mode | quality mode |
|---|---|---|---|---|---|---|---|---|
| dfn3 | 40 | 40.0 (no per-hop timing: latency only) | 15.3 | 39 | not measured (-) | 0.201 | PASS | PASS |
| rnnoise | 30 | 31.4 | 7.9 | 15 | NO (18.129) | 0.122 | FAIL | FAIL |
| gtcrn | 32 | 39.3 | 8.0 | 35 | yes (11.345) | 0.168 | PASS | PASS |
| dtln | 32 | 34.7 | 5.0 | 35 | NO (6.511) | 0.096 | FAIL | FAIL |
| hush | 20 | 24.9 | 5.4 | 41 | NO (11.715) | 0.150 | FAIL | FAIL |
| dpdfnet2 | 60 | 71.7 | 28.8 | 46 | NO (16.341) | 0.598 | FAIL | FAIL |
| dfn3_ll | 20 | 20.0 (no per-hop timing: latency only) | 55.4 | 166 | not measured (-) | 1.101 | FAIL | FAIL |
| dpdfnet2_48k | 60 | 78.0 | 40.0 | 47 | NO (39.719) | 0.748 | FAIL | FAIL |
