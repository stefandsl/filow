"""Tests for bakeoff_qwen3.py: it fails loudly on a wrong hash and when the server does not start,
talks to a stub server, and its paired speaker bootstrap reproduces known intervals.

  python -I test_bakeoff_qwen3.py

Uses port 8091 (the only port of item V2) and a scratch folder under G:/FILOW/tmp/audiocpp-bakeoff,
removed afterwards. Do not run it while the bake-off itself is running.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bakeoff_qwen3 as bq  # noqa: E402

SCRATCH_ROOT = Path("G:/FILOW/tmp/audiocpp-bakeoff/test-tmp")
PORT = 8091
HOST = "127.0.0.1"

STUB = r'''
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
mode, port = sys.argv[1], int(sys.argv[2])
if mode == "exit":
    sys.exit(3)
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        ids = ["qwen3-0.6b"] if mode == "ok" else []
        self._send({"object": "list", "data": [{"id": i} for i in ids]})
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        lang = body.split(b'name="language"\r\n\r\n')[1].split(b"\r\n")[0].decode()
        if lang == "Fail":
            self._send({"error": "no"}, 500)
        else:
            self._send({"text": f" heard {lang} {len(body)} ", "timing": {}})
HTTPServer(("127.0.0.1", port), H).serve_forever()
'''


def scratch():
    SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="t-", dir=SCRATCH_ROOT))


def remove_scratch(d):
    # Guard: only a folder this test created under SCRATCH_ROOT is ever removed.
    d = Path(d).resolve()
    if d.parent == SCRATCH_ROOT.resolve() and d.name.startswith("t-"):
        shutil.rmtree(d)


class Scratch(unittest.TestCase):
    def setUp(self):
        self.dir = scratch()

    def tearDown(self):
        remove_scratch(self.dir)


class HashFailures(Scratch):
    """The whole script, run as the critic runs it, with a manifest pointing at fake files."""

    def fake_manifest(self, zip_sha=None, model_sha=None, stt_sha=None):
        z, g = self.dir / "fake.zip", self.dir / "fake.gguf"
        z.write_bytes(b"not a zip")
        g.write_bytes(b"not a model")
        asr = self.dir / "asr.json"
        asr.write_text(json.dumps({"models": [{"key": "parakeet-v3", "archive": "a-b", "archive_sha256_in_stt_js": "1" * 64}]}), encoding="utf-8")
        stt = self.dir / "stt.js"
        stt.write_text(f'const C = {{ x: {{ archive: "a-b", url: "u", sha256: "{stt_sha or "1" * 64}" }} }};\n', encoding="utf-8")
        m = bq.read_json(HERE / "manifest" / "bakeoff-qwen3.json")
        m["server_zip"].update(path=str(z), sha256=zip_sha or bq.sha256_file(z))
        m["model"].update(path=str(g), sha256=model_sha or bq.sha256_file(g))
        m["baseline"].update(asr_json=str(asr), stt_js=str(stt))
        m["out_dir"] = str(self.dir / "out")
        p = self.dir / "manifest.json"
        p.write_text(json.dumps(m), encoding="utf-8")
        return p

    def run_script(self, manifest):
        env = dict(os.environ, QWEN3_BAKEOFF_MANIFEST=str(manifest))
        return subprocess.run([sys.executable, "-I", str(HERE / "bakeoff_qwen3.py")], env=env, capture_output=True, text=True, timeout=120)

    def assert_stopped_before_server(self, r, needle):
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("STOP", r.stderr)
        self.assertIn(needle, r.stderr)
        self.assertFalse((self.dir / "out" / "server.json").exists(), "a server config was written after a failed check")
        self.assertFalse(bq.port_in_use(HOST, PORT), "something listens on 8091 after a failed check")

    def test_wrong_zip_hash_stops(self):
        self.assert_stopped_before_server(self.run_script(self.fake_manifest(zip_sha="0" * 64)), "server_zip sha256 mismatch")

    def test_wrong_model_hash_stops(self):
        self.assert_stopped_before_server(self.run_script(self.fake_manifest(model_sha="0" * 64)), "model sha256 mismatch")

    def test_baseline_catalogue_changed_stops(self):
        self.assert_stopped_before_server(self.run_script(self.fake_manifest(stt_sha="2" * 64)), "a rerun is a separate decision")

    def test_inputs_and_catalogue_pass_when_they_match(self):
        m = bq.read_json(self.fake_manifest())
        self.assertEqual(set(bq.check_inputs(m)), {"server_zip", "model"})
        self.assertEqual(bq.check_baseline_catalogue(m["baseline"]["asr_json"], m["baseline"]["stt_js"]), ["parakeet-v3"])

    def test_real_stt_js_catalogue_is_parsed(self):
        cat = bq.stt_catalogue(bq.read_json(HERE / "manifest" / "bakeoff-qwen3.json")["baseline"]["stt_js"])
        self.assertEqual(cat["sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"], "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9")
        self.assertEqual(cat["silero_vad.onnx"], "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6")


class StubServer(Scratch):
    def stub(self, mode):
        p = self.dir / "stub.py"
        p.write_text(STUB, encoding="utf-8")
        return [sys.executable, "-I", str(p), mode, str(PORT)]

    def setUp(self):
        super().setUp()
        if bq.port_in_use(HOST, PORT):
            self.skipTest("port 8091 is busy (is the bake-off running?)")

    def test_server_that_never_lists_the_model_fails_and_is_stopped(self):
        t0 = time.monotonic()
        with self.assertRaises(SystemExit):
            bq.start_server(self.stub("never"), HOST, PORT, "qwen3-0.6b", 3)
        self.assertGreaterEqual(time.monotonic() - t0, 3)
        time.sleep(0.3)
        self.assertFalse(bq.port_in_use(HOST, PORT), "the stub server was left running")

    def test_server_that_exits_fails_at_once(self):
        t0 = time.monotonic()
        with self.assertRaises(SystemExit):
            bq.start_server(self.stub("exit"), HOST, PORT, "qwen3-0.6b", 30)
        self.assertLess(time.monotonic() - t0, 15)

    def test_busy_port_fails_without_starting(self):
        proc = bq.start_server(self.stub("ok"), HOST, PORT, "qwen3-0.6b", 20)
        try:
            with self.assertRaises(SystemExit):
                bq.start_server(self.stub("ok"), HOST, PORT, "qwen3-0.6b", 5)
            self.assertIsNone(proc.poll(), "the server already on the port was stopped")
        finally:
            bq.stop_server(proc)

    def test_transcription_round_trip_and_failure_is_empty(self):
        wav = self.dir / "a.wav"
        wav.write_bytes(b"RIFF0000WAVE")
        proc = bq.start_server(self.stub("ok"), HOST, PORT, "qwen3-0.6b", 20)
        try:
            status, text, ms = bq.transcribe(HOST, PORT, "qwen3-0.6b", wav, "Romanian", 10)
            self.assertEqual(status, 200)
            self.assertTrue(text.startswith("heard Romanian "), text)
            self.assertGreater(ms, 0)
            status, text, _ = bq.transcribe(HOST, PORT, "qwen3-0.6b", wav, "Fail", 10)
            self.assertEqual((status, text), (500, ""))
            sampler = bq.RamSampler(proc.pid, 20)
            sampler.tag = "ro"
            sampler.start()
            time.sleep(0.3)
            sampler.halt.set()
            sampler.join()
            self.assertGreater(sampler.peak("ro"), 1_000_000)
            self.assertIsNone(sampler.peak("ja"))
        finally:
            bq.stop_server(proc)
        status, text, _ = bq.transcribe(HOST, PORT, "qwen3-0.6b", wav, "Romanian", 3)
        self.assertNotEqual(status, 200)
        self.assertEqual(text, "")


class Bootstrap(unittest.TestCase):
    def test_constant_difference_gives_a_zero_width_interval(self):
        # Every speaker is exactly 5 points better with the candidate; only a paired bootstrap keeps that exact.
        n = np.array([10, 20, 30, 40])
        e_base = np.array([1, 4, 9, 16])
        e_cand = e_base - 0.05 * n
        draws = bq.speaker_draws(4, 2000, np.random.default_rng(1))
        base, cand, diff, lo, hi = bq.paired_interval(e_base, e_cand, n, draws)
        self.assertAlmostEqual(base, 30.0)
        self.assertAlmostEqual(diff, -5.0)
        self.assertAlmostEqual(lo, -5.0, places=9)
        self.assertAlmostEqual(hi, -5.0, places=9)

    def test_two_speakers_give_the_enumerable_interval(self):
        # Speaker A +10 pt, speaker B +30 pt, equal tokens: draws (2,0), (1,1), (0,2) give +10, +20, +30
        # with probability 1/4, 1/2, 1/4, so the 2.5 and 97.5 percentiles are +10 and +30.
        draws = bq.speaker_draws(2, 2000, np.random.default_rng(20261112))
        base, cand, diff, lo, hi = bq.paired_interval([0, 0], [1, 3], [10, 10], draws)
        self.assertEqual((round(diff, 9), round(lo, 9), round(hi, 9)), (20.0, 10.0, 30.0))

    def test_score_language_uses_score_py_normalisation(self):
        clips = [{"clip_id": "a", "utterance_id": "u1", "speaker_id": "s1"}, {"clip_id": "b", "utterance_id": "u2", "speaker_id": "s2"}]
        refs = {"u1": "Ce faci, Ştefan?", "u2": "bună ziua"}
        draws = bq.speaker_draws(2, 200, np.random.default_rng(0))
        (base, cand, diff, lo, hi), spk, tokens = bq.score_language(clips, refs, {"a": "ce faci ștefan", "b": "buna ziua"}, {"a": "CE FACI ȘTEFAN!", "b": "bună ziua"}, "ro", draws)
        self.assertEqual((spk, tokens), (2, 5))
        self.assertAlmostEqual(base, 20.0)
        self.assertAlmostEqual(cand, 0.0)

    def test_gates(self):
        g = {"min_gain_points": 2.0, "max_median_rtf": 0.5, "max_peak_ram_gb": 1.5}
        self.assertEqual(bq.decide(-2.0, -0.1, 0.5, 1.5e9, g), (True, []))
        self.assertFalse(bq.decide(-1.99, -0.1, 0.1, 1e9, g)[0])
        self.assertFalse(bq.decide(-5.0, 0.0, 0.1, 1e9, g)[0])
        self.assertFalse(bq.decide(-5.0, -1.0, 0.51, 1e9, g)[0])
        self.assertFalse(bq.decide(-5.0, -1.0, 0.1, 1.5e9 + 1, g)[0])
        self.assertFalse(bq.decide(-5.0, -1.0, 0.1, None, g)[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
