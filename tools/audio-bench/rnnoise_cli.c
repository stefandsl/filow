/* Minimal driver for xiph/rnnoise: 48 kHz mono 16-bit raw PCM in, denoised raw PCM out, and the
 * wall time of every 10 ms frame (float32 milliseconds) so per-hop percentiles can be computed.
 * Usage: rnnoise_cli in.raw out.raw times.f32
 * Built with build_rnnoise.ps1 against the pinned source tree; the weights are the pinned
 * rnnoise_data tarball compiled in (src/rnnoise_data.c).
 */
#include <stdio.h>
#include <stdlib.h>
#include <windows.h>
#include "rnnoise.h"

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: rnnoise_cli in.raw out.raw times.f32\n"); return 2; }
  FILE *in = fopen(argv[1], "rb"), *out = fopen(argv[2], "wb"), *times = fopen(argv[3], "wb");
  if (!in || !out || !times) { fprintf(stderr, "cannot open files\n"); return 1; }
  DenoiseState *st = rnnoise_create(NULL);
  int n = rnnoise_get_frame_size();
  short *pcm = (short *)malloc(sizeof(short) * n);
  float *x = (float *)malloc(sizeof(float) * n);
  LARGE_INTEGER freq, t0, t1;
  QueryPerformanceFrequency(&freq);
  for (;;) {
    size_t got = fread(pcm, sizeof(short), n, in);
    if (got == 0) break;
    for (int i = 0; i < n; i++) x[i] = i < (int)got ? (float)pcm[i] : 0.0f;
    QueryPerformanceCounter(&t0);
    rnnoise_process_frame(st, x, x);
    QueryPerformanceCounter(&t1);
    float ms = (float)((double)(t1.QuadPart - t0.QuadPart) * 1000.0 / (double)freq.QuadPart);
    fwrite(&ms, sizeof(float), 1, times);
    for (int i = 0; i < n; i++) {
      float v = x[i];
      pcm[i] = (short)(v > 32767.0f ? 32767 : v < -32768.0f ? -32768 : (v < 0 ? v - 0.5f : v + 0.5f));
    }
    fwrite(pcm, sizeof(short), n, out);
  }
  rnnoise_destroy(st);
  fclose(in); fclose(out); fclose(times);
  return 0;
}
