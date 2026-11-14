# Natural voice measurement tables

See [method, selection, licences and limits](VOICE-NATURAL-2026-11.md).
MOS is the local DNSMOS P.808 proxy, not a human naturalness rating. Errors are
Whisper word edits/reference words, or character edits/reference characters for
Japanese. F0 is mean per-answer voiced SD/full range; per-piece values are retained
in the raw metrics. First is median warm first-piece time, not physical output.
RSS is sampled, not peak. Sizes are extracted model assets, not download archives.
Pause is median per-answer median RMS silence run (>=80 ms). RTF <1 is real time.
All models are CPU-only, four threads, on an i9-13900KF. Timing the initial baseline
during dependency work inflated it; use baseline-repeat. Pipeline includes worker
delivery but does not measure realtime playback starvation; separate queue results
in the main report do. Each variant is one take, so small differences are uncertain.

Supertonic variants cover all five languages under OpenRAIL-M. Full is the third
alternative evaluated alongside Piper and Kokoro, not a separate architecture.
Piper covers EN/IT/RU/RO here (Joe/Paola/Denis/Mihai); voice-specific CC0 datasets
and MIT repository declaration were checked. Kokoro covers EN/IT in this export;
Japanese exists upstream but was not verified here, and RU/RO are unsupported.
All applicable upstream licence conditions still apply. No candidate was shipped.

| Variant | Language | n | MOS proxy | Errors | F0 SD/range Hz | First ms | RTF | RSS MiB | Model MiB | Licence |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline | it | 12 | 3.69 | 1/109 | 36.1/141.1 | 1073 | 0.418 | 345 | 138.6 | OpenRAIL-M |
| baseline | en | 5 | 3.65 | 0/65 | 32.2/128.5 | 1062 | 0.453 | 329 | 138.6 | OpenRAIL-M |
| baseline | ru | 5 | 3.67 | 2/49 | 36.2/164.9 | 967 | 0.390 | 348 | 138.6 | OpenRAIL-M |
| baseline | ro | 5 | 3.76 | 3/59 | 37.4/159.3 | 1332 | 0.421 | 370 | 138.6 | OpenRAIL-M |
| baseline | ja | 5 | 3.67 | 9/147 | 34.8/145.6 | 1147 | 0.406 | 378 | 138.6 | OpenRAIL-M |
| baseline-repeat | it | 12 | 3.64 | 3/109 | 34.3/137.0 | 645 | 0.246 | 330 | 138.6 | OpenRAIL-M |
| baseline-repeat | en | 5 | 3.54 | 0/65 | 31.1/145.7 | 541 | 0.235 | 345 | 138.6 | OpenRAIL-M |
| baseline-repeat | ru | 5 | 3.58 | 3/49 | 33.1/147.3 | 551 | 0.213 | 332 | 138.6 | OpenRAIL-M |
| baseline-repeat | ro | 5 | 3.71 | 2/59 | 40.4/179.9 | 645 | 0.225 | 383 | 138.6 | OpenRAIL-M |
| baseline-repeat | ja | 5 | 3.64 | 6/147 | 35.6/148.5 | 590 | 0.234 | 373 | 138.6 | OpenRAIL-M |
| full | it | 12 | 3.76 | 0/109 | 36.5/141.1 | 578 | 0.234 | 537 | 380.4 | OpenRAIL-M |
| full | en | 5 | 3.80 | 0/65 | 32.9/142.8 | 529 | 0.268 | 523 | 380.4 | OpenRAIL-M |
| full | ru | 5 | 3.81 | 2/49 | 36.8/151.2 | 894 | 0.361 | 546 | 380.4 | OpenRAIL-M |
| full | ro | 5 | 3.87 | 4/59 | 37.8/169.9 | 1137 | 0.387 | 534 | 380.4 | OpenRAIL-M |
| full | ja | 5 | 3.78 | 7/147 | 36.8/140.5 | 1025 | 0.376 | 549 | 380.4 | OpenRAIL-M |
| kokoro | en | 5 | 3.50 | 0/65 | 34.5/150.6 | 3598 | 1.573 | 420 | 181.1 | Apache-2.0 |
| kokoro | it | 12 | 3.47 | 0/109 | 30.4/136.5 | 3757 | 1.409 | 706 | 181.1 | Apache-2.0 |
| pipeline | it | 12 | 3.65 | 2/109 | 34.6/140.7 | 937 | 0.379 | n/a | 138.6 | OpenRAIL-M |
| pipeline | en | 5 | 3.70 | 0/65 | 34.4/155.3 | 943 | 0.431 | n/a | 138.6 | OpenRAIL-M |
| pipeline | ru | 5 | 3.52 | 2/49 | 36.7/161.4 | 976 | 0.386 | n/a | 138.6 | OpenRAIL-M |
| pipeline | ro | 5 | 3.67 | 3/59 | 35.4/154.4 | 1197 | 0.399 | n/a | 138.6 | OpenRAIL-M |
| pipeline | ja | 5 | 3.62 | 10/147 | 35.8/154.3 | 1073 | 0.409 | n/a | 138.6 | OpenRAIL-M |
| piper | en | 5 | 3.86 | 0/65 | 13.4/52.6 | 92 | 0.043 | 248 | 77.4 | MIT / CC0 dataset |
| piper | it | 12 | 3.66 | 7/109 | 23.4/105.1 | 141 | 0.067 | 410 | 77.4 | MIT / CC0 dataset |
| piper | ru | 5 | 3.69 | 3/49 | 29.1/129.1 | 196 | 0.070 | 604 | 77.4 | MIT / CC0 dataset |
| piper | ro | 5 | 3.92 | 4/59 | 14.2/76.7 | 224 | 0.068 | 797 | 77.4 | MIT / CC0 dataset |
| raw | it | 12 | 3.70 | 15/109 | 32.5/131.8 | 726 | 0.183 | 341 | 138.6 | OpenRAIL-M |
| raw | en | 5 | 3.63 | 0/65 | 37.2/153.4 | 636 | 0.197 | 337 | 138.6 | OpenRAIL-M |
| raw | ru | 5 | 3.69 | 1/49 | 35.2/146.8 | 694 | 0.173 | 344 | 138.6 | OpenRAIL-M |
| raw | ro | 5 | 3.70 | 1/59 | 34.1/146.9 | 830 | 0.188 | 358 | 138.6 | OpenRAIL-M |
| raw | ja | 5 | 3.74 | 5/147 | 37.9/152.1 | 674 | 0.179 | 360 | 138.6 | OpenRAIL-M |
| speaker1 | it | 12 | 3.63 | 0/109 | 66.0/281.2 | 621 | 0.250 | 339 | 138.6 | OpenRAIL-M |
| speaker1 | en | 5 | 3.59 | 0/65 | 40.9/158.4 | 519 | 0.255 | 340 | 138.6 | OpenRAIL-M |
| speaker1 | ru | 5 | 3.57 | 4/49 | 57.1/229.1 | 622 | 0.232 | 342 | 138.6 | OpenRAIL-M |
| speaker1 | ro | 5 | 3.64 | 3/59 | 46.2/207.5 | 656 | 0.230 | 363 | 138.6 | OpenRAIL-M |
| speaker1 | ja | 5 | 3.61 | 15/147 | 53.2/211.2 | 602 | 0.233 | 379 | 138.6 | OpenRAIL-M |
| speaker2 | it | 12 | 3.92 | 1/109 | 38.9/153.7 | 668 | 0.248 | 342 | 138.6 | OpenRAIL-M |
| speaker2 | en | 5 | 3.83 | 0/65 | 39.0/156.5 | 520 | 0.225 | 331 | 138.6 | OpenRAIL-M |
| speaker2 | ru | 5 | 3.75 | 0/49 | 39.9/173.6 | 602 | 0.212 | 354 | 138.6 | OpenRAIL-M |
| speaker2 | ro | 5 | 3.88 | 0/59 | 37.3/167.7 | 682 | 0.228 | 374 | 138.6 | OpenRAIL-M |
| speaker2 | ja | 5 | 3.70 | 23/147 | 41.8/169.7 | 635 | 0.211 | 381 | 138.6 | OpenRAIL-M |
| speaker3 | it | 12 | 3.55 | 3/109 | 28.9/120.7 | 635 | 0.265 | 338 | 138.6 | OpenRAIL-M |
| speaker3 | en | 5 | 3.56 | 0/65 | 24.4/98.7 | 575 | 0.277 | 339 | 138.6 | OpenRAIL-M |
| speaker3 | ru | 5 | 3.46 | 4/49 | 24.3/109.1 | 541 | 0.229 | 340 | 138.6 | OpenRAIL-M |
| speaker3 | ro | 5 | 3.54 | 10/59 | 41.6/159.1 | 687 | 0.277 | 348 | 138.6 | OpenRAIL-M |
| speaker3 | ja | 5 | 3.70 | 16/147 | 23.4/109.3 | 637 | 0.245 | 341 | 138.6 | OpenRAIL-M |
| speaker4 | it | 12 | 3.82 | 2/109 | 25.0/103.2 | 649 | 0.249 | 343 | 138.6 | OpenRAIL-M |
| speaker4 | en | 5 | 3.71 | 0/65 | 30.7/127.2 | 677 | 0.273 | 326 | 138.6 | OpenRAIL-M |
| speaker4 | ru | 5 | 3.69 | 4/49 | 26.4/122.5 | 609 | 0.215 | 346 | 138.6 | OpenRAIL-M |
| speaker4 | ro | 5 | 3.80 | 1/59 | 29.0/143.0 | 617 | 0.214 | 368 | 138.6 | OpenRAIL-M |
| speaker4 | ja | 5 | 3.78 | 3/147 | 32.8/132.1 | 601 | 0.208 | 382 | 138.6 | OpenRAIL-M |
| speaker5 | it | 12 | 3.83 | 7/109 | 34.2/143.5 | 636 | 0.239 | 345 | 138.6 | OpenRAIL-M |
| speaker5 | en | 5 | 3.83 | 0/65 | 35.7/144.1 | 529 | 0.227 | 328 | 138.6 | OpenRAIL-M |
| speaker5 | ru | 5 | 3.88 | 2/49 | 33.0/146.6 | 587 | 0.197 | 347 | 138.6 | OpenRAIL-M |
| speaker5 | ro | 5 | 3.89 | 4/59 | 31.6/137.5 | 684 | 0.242 | 334 | 138.6 | OpenRAIL-M |
| speaker5 | ja | 5 | 3.92 | 8/147 | 31.7/136.1 | 680 | 0.237 | 342 | 138.6 | OpenRAIL-M |
| speaker6 | it | 12 | 3.81 | 2/109 | 16.5/64.4 | 648 | 0.263 | 337 | 138.6 | OpenRAIL-M |
| speaker6 | en | 5 | 3.76 | 0/65 | 11.4/50.1 | 599 | 0.282 | 342 | 138.6 | OpenRAIL-M |
| speaker6 | ru | 5 | 3.46 | 3/49 | 11.4/50.5 | 623 | 0.236 | 339 | 138.6 | OpenRAIL-M |
| speaker6 | ro | 5 | 3.86 | 2/59 | 8.7/42.4 | 707 | 0.254 | 363 | 138.6 | OpenRAIL-M |
| speaker6 | ja | 5 | 3.89 | 13/147 | 16.5/69.3 | 629 | 0.236 | 379 | 138.6 | OpenRAIL-M |
| speaker7 | it | 12 | 3.89 | 1/109 | 16.3/66.5 | 571 | 0.257 | 324 | 138.6 | OpenRAIL-M |
| speaker7 | en | 5 | 3.73 | 0/65 | 15.3/63.8 | 496 | 0.256 | 341 | 138.6 | OpenRAIL-M |
| speaker7 | ru | 5 | 3.58 | 5/49 | 11.9/57.5 | 587 | 0.258 | 346 | 138.6 | OpenRAIL-M |
| speaker7 | ro | 5 | 3.87 | 6/59 | 19.1/85.8 | 663 | 0.251 | 340 | 138.6 | OpenRAIL-M |
| speaker7 | ja | 5 | 3.92 | 18/147 | 13.8/57.2 | 561 | 0.253 | 347 | 138.6 | OpenRAIL-M |
| speaker8 | it | 12 | 3.90 | 2/109 | 22.8/91.1 | 641 | 0.255 | 324 | 138.6 | OpenRAIL-M |
| speaker8 | en | 5 | 3.82 | 0/65 | 20.8/85.9 | 617 | 0.250 | 343 | 138.6 | OpenRAIL-M |
| speaker8 | ru | 5 | 3.84 | 3/49 | 21.0/91.3 | 626 | 0.225 | 345 | 138.6 | OpenRAIL-M |
| speaker8 | ro | 5 | 4.00 | 8/59 | 24.2/107.0 | 733 | 0.231 | 380 | 138.6 | OpenRAIL-M |
| speaker8 | ja | 5 | 3.79 | 11/147 | 26.1/101.5 | 673 | 0.220 | 365 | 138.6 | OpenRAIL-M |
| speaker9 | it | 12 | 3.97 | 0/109 | 15.2/69.0 | 669 | 0.250 | 335 | 138.6 | OpenRAIL-M |
| speaker9 | en | 5 | 3.92 | 0/65 | 13.9/62.8 | 584 | 0.245 | 338 | 138.6 | OpenRAIL-M |
| speaker9 | ru | 5 | 3.84 | 4/49 | 15.8/71.2 | 587 | 0.216 | 345 | 138.6 | OpenRAIL-M |
| speaker9 | ro | 5 | 4.03 | 1/59 | 14.9/68.8 | 704 | 0.210 | 380 | 138.6 | OpenRAIL-M |
| speaker9 | ja | 5 | 4.00 | 14/147 | 16.4/68.7 | 618 | 0.224 | 382 | 138.6 | OpenRAIL-M |
| speed100 | it | 12 | 3.67 | 1/109 | 35.0/135.2 | 655 | 0.237 | 342 | 138.6 | OpenRAIL-M |
| speed100 | en | 5 | 3.76 | 0/65 | 32.9/146.3 | 535 | 0.237 | 330 | 138.6 | OpenRAIL-M |
| speed100 | ru | 5 | 3.58 | 1/49 | 38.7/160.3 | 573 | 0.207 | 379 | 138.6 | OpenRAIL-M |
| speed100 | ro | 5 | 3.67 | 3/59 | 37.8/171.2 | 723 | 0.224 | 374 | 138.6 | OpenRAIL-M |
| speed100 | ja | 5 | 3.73 | 3/147 | 33.7/134.2 | 614 | 0.214 | 382 | 138.6 | OpenRAIL-M |
| steps4 | it | 12 | 3.71 | 0/109 | 36.0/142.1 | 495 | 0.195 | 346 | 138.6 | OpenRAIL-M |
| steps4 | en | 5 | 3.56 | 0/65 | 32.1/134.2 | 483 | 0.201 | 329 | 138.6 | OpenRAIL-M |
| steps4 | ru | 5 | 3.53 | 4/49 | 35.5/149.3 | 494 | 0.181 | 347 | 138.6 | OpenRAIL-M |
| steps4 | ro | 5 | 3.69 | 4/59 | 38.5/174.2 | 551 | 0.181 | 369 | 138.6 | OpenRAIL-M |
| steps4 | ja | 5 | 3.58 | 22/147 | 35.9/135.4 | 538 | 0.189 | 384 | 138.6 | OpenRAIL-M |
| steps6 | it | 12 | 3.65 | 2/109 | 32.6/128.7 | 806 | 0.305 | 335 | 138.6 | OpenRAIL-M |
| steps6 | en | 5 | 3.69 | 0/65 | 33.8/136.9 | 712 | 0.374 | 336 | 138.6 | OpenRAIL-M |
| steps6 | ru | 5 | 3.57 | 2/49 | 33.4/141.1 | 983 | 0.401 | 343 | 138.6 | OpenRAIL-M |
| steps6 | ro | 5 | 3.69 | 2/59 | 33.3/154.4 | 1443 | 0.458 | 378 | 138.6 | OpenRAIL-M |
| steps6 | ja | 5 | 3.60 | 10/147 | 35.8/137.0 | 1298 | 0.419 | 384 | 138.6 | OpenRAIL-M |
| steps8 | it | 12 | 3.62 | 3/109 | 35.2/144.7 | 1049 | 0.410 | 344 | 138.6 | OpenRAIL-M |
| steps8 | en | 5 | 3.64 | 0/65 | 34.1/140.3 | 848 | 0.386 | 327 | 138.6 | OpenRAIL-M |
| steps8 | ru | 5 | 3.56 | 2/49 | 34.9/150.6 | 924 | 0.350 | 345 | 138.6 | OpenRAIL-M |
| steps8 | ro | 5 | 3.76 | 5/59 | 37.6/155.0 | 1090 | 0.357 | 368 | 138.6 | OpenRAIL-M |
| steps8 | ja | 5 | 3.67 | 10/147 | 35.2/135.7 | 1019 | 0.355 | 382 | 138.6 | OpenRAIL-M |
| whole | it | 12 | 3.69 | 2/109 | 33.1/138.2 | 731 | 0.203 | 341 | 138.6 | OpenRAIL-M |
| whole | en | 5 | 3.72 | 0/65 | 38.1/162.4 | 639 | 0.186 | 330 | 138.6 | OpenRAIL-M |
| whole | ru | 5 | 3.65 | 4/49 | 29.8/139.8 | 709 | 0.179 | 360 | 138.6 | OpenRAIL-M |
| whole | ro | 5 | 3.75 | 3/59 | 40.2/177.6 | 1101 | 0.230 | 354 | 138.6 | OpenRAIL-M |
| whole | ja | 5 | 3.61 | 10/147 | 32.0/144.7 | 1239 | 0.314 | 362 | 138.6 | OpenRAIL-M |

## Pause and clipping checks

| Variant | Language | Pause median ms | Clipped sample fraction |
|---|---|---:|---:|
| baseline | it | 110 | 0.000000 |
| baseline | en | 180 | 0.000000 |
| baseline | ru | 130 | 0.000000 |
| baseline | ro | 170 | 0.000000 |
| baseline | ja | 145 | 0.000000 |
| baseline-repeat | it | 90 | 0.000000 |
| baseline-repeat | en | 110 | 0.000000 |
| baseline-repeat | ru | 110 | 0.000000 |
| baseline-repeat | ro | 90 | 0.000000 |
| baseline-repeat | ja | 185 | 0.000000 |
| full | it | 98 | 0.000000 |
| full | en | 140 | 0.000000 |
| full | ru | 85 | 0.000000 |
| full | ro | 135 | 0.000000 |
| full | ja | 130 | 0.000000 |
| kokoro | en | 115 | 0.000000 |
| kokoro | it | 90 | 0.000000 |
| pipeline | it | 110 | 0.000010 |
| pipeline | en | 135 | 0.000000 |
| pipeline | ru | 90 | 0.000000 |
| pipeline | ro | 180 | 0.000000 |
| pipeline | ja | 120 | 0.000000 |
| piper | en | 110 | 0.000000 |
| piper | it | 98 | 0.000000 |
| piper | ru | 95 | 0.000000 |
| piper | ro | 90 | 0.000000 |
| raw | it | 102 | 0.000000 |
| raw | en | 190 | 0.000000 |
| raw | ru | 90 | 0.000000 |
| raw | ro | 150 | 0.000000 |
| raw | ja | 95 | 0.000000 |
| speaker1 | it | 122 | 0.000000 |
| speaker1 | en | 115 | 0.000000 |
| speaker1 | ru | 115 | 0.000000 |
| speaker1 | ro | 120 | 0.000000 |
| speaker1 | ja | 135 | 0.000000 |
| speaker2 | it | 115 | 0.000000 |
| speaker2 | en | 125 | 0.000000 |
| speaker2 | ru | 170 | 0.000000 |
| speaker2 | ro | 100 | 0.000000 |
| speaker2 | ja | 130 | 0.000000 |
| speaker3 | it | 148 | 0.000000 |
| speaker3 | en | 110 | 0.000000 |
| speaker3 | ru | 120 | 0.000000 |
| speaker3 | ro | 250 | 0.000000 |
| speaker3 | ja | 110 | 0.000000 |
| speaker4 | it | 182 | 0.000000 |
| speaker4 | en | 150 | 0.000000 |
| speaker4 | ru | 170 | 0.000000 |
| speaker4 | ro | 170 | 0.000000 |
| speaker4 | ja | 260 | 0.000000 |
| speaker5 | it | 155 | 0.000000 |
| speaker5 | en | 150 | 0.000000 |
| speaker5 | ru | 210 | 0.000000 |
| speaker5 | ro | 140 | 0.000000 |
| speaker5 | ja | 210 | 0.000000 |
| speaker6 | it | 115 | 0.000000 |
| speaker6 | en | 140 | 0.000000 |
| speaker6 | ru | 110 | 0.000000 |
| speaker6 | ro | 110 | 0.000000 |
| speaker6 | ja | 125 | 0.000000 |
| speaker7 | it | 45 | 0.000000 |
| speaker7 | en | 150 | 0.000000 |
| speaker7 | ru | 160 | 0.000000 |
| speaker7 | ro | 110 | 0.000000 |
| speaker7 | ja | 135 | 0.000000 |
| speaker8 | it | 145 | 0.000000 |
| speaker8 | en | 120 | 0.000000 |
| speaker8 | ru | 135 | 0.000000 |
| speaker8 | ro | 210 | 0.000000 |
| speaker8 | ja | 215 | 0.000000 |
| speaker9 | it | 90 | 0.000000 |
| speaker9 | en | 100 | 0.000000 |
| speaker9 | ru | 90 | 0.000000 |
| speaker9 | ro | 110 | 0.000000 |
| speaker9 | ja | 100 | 0.000000 |
| speed100 | it | 165 | 0.000000 |
| speed100 | en | 130 | 0.000000 |
| speed100 | ru | 110 | 0.000000 |
| speed100 | ro | 120 | 0.000000 |
| speed100 | ja | 120 | 0.000000 |
| steps4 | it | 150 | 0.000000 |
| steps4 | en | 190 | 0.000000 |
| steps4 | ru | 160 | 0.000015 |
| steps4 | ro | 130 | 0.000043 |
| steps4 | ja | 180 | 0.000000 |
| steps6 | it | 112 | 0.000000 |
| steps6 | en | 200 | 0.000000 |
| steps6 | ru | 100 | 0.000000 |
| steps6 | ro | 205 | 0.000000 |
| steps6 | ja | 215 | 0.000000 |
| steps8 | it | 40 | 0.000000 |
| steps8 | en | 100 | 0.000000 |
| steps8 | ru | 90 | 0.000000 |
| steps8 | ro | 110 | 0.000000 |
| steps8 | ja | 130 | 0.000000 |
| whole | it | 90 | 0.000000 |
| whole | en | 150 | 0.000000 |
| whole | ru | 110 | 0.000000 |
| whole | ro | 110 | 0.000000 |
| whole | ja | 130 | 0.000000 |
