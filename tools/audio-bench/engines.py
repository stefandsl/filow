"""Streaming wrappers for the ONNX noise-suppression candidates (onnxruntime on the CPU).

Each wrapper follows its author's reference loop (see the comment on each class) and carries the
model state between hops. push() accepts chunks of any size; the output is the same whatever the
chunk size (checked by `enhance.py check`). hop_ms collects the wall time of every hop: windowing,
FFT, the model call and overlap-add.
"""
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

from common import WORK

MODELS = WORK / "models"


_SESSIONS = {}


def session(path, threads):
    """One onnxruntime session per model file and thread count; the wrappers keep the state, so a
    new recording only needs a new wrapper (loading the 10 MB graphs again costs about a second)."""
    key = (str(path), threads)
    if key not in _SESSIONS:
        _SESSIONS[key] = _load(path, threads)
    return _SESSIONS[key]


def _load(path, threads):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])


class Stream:
    """Buffers input into hops. Subclasses set sr, hop and implement _hop(samples) -> hop samples."""
    sr = 16000
    hop = 0

    def __init__(self):
        self._pending = np.zeros(0, np.float32)
        self.hop_ms = []
        self.consumed = 0
        self.emitted = 0
        self.worst_wait = 0  # max over emitted chunks of (input samples seen - index of the chunk's first sample)

    def push(self, chunk):
        chunk = np.asarray(chunk, np.float32)
        self.consumed += len(chunk)
        self._pending = np.concatenate([self._pending, chunk])
        out = []
        while len(self._pending) >= self.hop:
            # how much input had arrived when this hop could first run
            seen = self.consumed - (len(self._pending) - self.hop)
            t0 = time.perf_counter()
            y = self._hop(self._pending[: self.hop])
            self.hop_ms.append((time.perf_counter() - t0) * 1000)
            self._pending = self._pending[self.hop:]
            if len(y):
                self.worst_wait = max(self.worst_wait, seen - self.emitted)
                self.emitted += len(y)
                out.append(y)
        return np.concatenate(out) if out else np.zeros(0, np.float32)


class Gtcrn(Stream):
    """Xiaobin-Rong/gtcrn stream/gtcrn_stream.py: STFT 512/256 with a square-root Hann window, one
    frame per call of the streaming graph, three caches carried between frames."""
    hop = 256

    def __init__(self, threads=1):
        super().__init__()
        self.s = session(MODELS / "gtcrn" / "gtcrn_simple.onnx", threads)
        self.win = np.sqrt(np.hanning(513)[:512]).astype(np.float32)  # periodic Hann, as torch.hann_window
        self.buf = np.zeros(512, np.float32)
        self.ola = np.zeros(512, np.float32)
        self.caches = {"conv_cache": np.zeros([2, 1, 16, 16, 33], np.float32), "tra_cache": np.zeros([2, 3, 1, 1, 16], np.float32),
                       "inter_cache": np.zeros([2, 1, 33, 16], np.float32)}

    def _hop(self, x):
        self.buf[:256] = self.buf[256:]
        self.buf[256:] = x
        spec = np.fft.rfft(self.buf * self.win)
        mix = np.stack([spec.real, spec.imag], axis=-1).astype(np.float32)[None, :, None, :]
        enh, conv, tra, inter = self.s.run(None, {"mix": mix, **self.caches})
        self.caches = {"conv_cache": conv, "tra_cache": tra, "inter_cache": inter}
        frame = np.fft.irfft(enh[0, :, 0, 0] + 1j * enh[0, :, 0, 1], n=512).astype(np.float32) * self.win
        self.ola += frame
        out = self.ola[:256].copy()
        self.ola[:256] = self.ola[256:]
        self.ola[256:] = 0
        return out


class Dtln(Stream):
    """breizhn/DTLN real_time_processing_onnx.py: block 512, shift 128; model_1 masks the magnitude
    spectrum, model_2 works on the time block; each keeps its LSTM state between blocks."""
    hop = 128

    def __init__(self, threads=1):
        super().__init__()
        self.s1 = session(MODELS / "dtln" / "model_1.onnx", threads)
        self.s2 = session(MODELS / "dtln" / "model_2.onnx", threads)
        self.n1 = [i.name for i in self.s1.get_inputs()]
        self.n2 = [i.name for i in self.s2.get_inputs()]
        self.st1 = np.zeros([1, 2, 128, 2], np.float32)
        self.st2 = np.zeros([1, 2, 128, 2], np.float32)
        self.inb = np.zeros(512, np.float32)
        self.outb = np.zeros(512, np.float32)

    def _hop(self, x):
        self.inb[:-128] = self.inb[128:]
        self.inb[-128:] = x
        fft = np.fft.rfft(self.inb)
        mag = np.abs(fft).astype(np.float32).reshape(1, 1, -1)
        mask, self.st1 = self.s1.run(None, {self.n1[0]: mag, self.n1[1]: self.st1})
        block = np.fft.irfft(mag * mask * np.exp(1j * np.angle(fft))).astype(np.float32).reshape(1, 1, -1)
        out, self.st2 = self.s2.run(None, {self.n2[0]: block, self.n2[1]: self.st2})
        self.outb[:-128] = self.outb[128:]
        self.outb[-128:] = 0
        self.outb += np.squeeze(out)
        return self.outb[:128].copy()


class Dpdfnet(Stream):
    """ceva-ip/DPDFNet package/src/dpdfnet/stream.py (StreamEnhancer): causal STFT with the Vorbis
    window, window = 20 ms, hop = 10 ms, one (spec, state) -> (spec_e, state) call per frame; the
    initial state comes from the model metadata (onnx_backend.load_initial_state_from_metadata)."""

    def __init__(self, threads=1, file="dpdfnet2/dpdfnet2.onnx"):
        super().__init__()
        self.s = session(MODELS / file, threads)
        meta = self.s.get_modelmeta().custom_metadata_map
        self.sr = int(meta["sample_rate"])
        self.win_len = (self.s.get_inputs()[0].shape[-2] - 1) * 2
        self.hop = self.win_len // 2
        i = np.arange(self.win_len)
        self.win = np.sin(0.5 * np.pi * np.sin(0.5 * np.pi * (i + 0.5) / (self.win_len / 2)) ** 2).astype(np.float32)
        n_erb, n_spec = int(meta["erb_norm_state_size"]), int(meta["spec_norm_state_size"])
        self.state = np.zeros(int(meta["state_size"]), np.float32)
        self.state[:n_erb] = [float(v) for v in meta["erb_norm_init"].split(",")]
        self.state[n_erb:n_erb + n_spec] = [float(v) for v in meta["spec_norm_init"].split(",")]
        self.names = [i.name for i in self.s.get_inputs()]
        self.inb = np.zeros(0, np.float32)
        self.ola = np.zeros(self.win_len, np.float32)

    def _hop(self, x):
        self.inb = np.concatenate([self.inb, x])
        if len(self.inb) < self.win_len:  # the author's loop waits for a whole window before the first frame
            return np.zeros(0, np.float32)
        spec = np.fft.rfft(self.inb[: self.win_len] * self.win, n=self.win_len)
        spec_ri = np.stack([spec.real.astype(np.float32), spec.imag.astype(np.float32)], axis=-1)[None, None]
        spec_e, self.state = self.s.run(None, {self.names[0]: spec_ri, self.names[1]: self.state})
        ri = spec_e[0, 0]
        self.ola += (np.fft.irfft(ri[:, 0] + 1j * ri[:, 1], n=self.win_len) * self.win).astype(np.float32)
        out = self.ola[: self.hop].copy()
        self.ola[: self.win_len - self.hop] = self.ola[self.hop:]
        self.ola[self.win_len - self.hop:] = 0
        self.inb = self.inb[self.hop:]
        return out


class Dpdfnet48(Dpdfnet):
    def __init__(self, threads=1):
        super().__init__(threads, "dpdfnet2_48k/dpdfnet2_48khz_hr.onnx")


class Hush(Stream):
    """pulp-vision/Hush deployment (deployment/README.md, include/weya_nc.h): the repository's own
    prebuilt weya_nc.dll (a DeepFilterNet-style runtime) loaded with ctypes, the model bundle from
    Hugging Face passed by path, one 10 ms frame per call at 16 kHz, no attenuation limit."""
    hop = 160
    _lib = None
    _model = None

    def __init__(self, threads=1):
        super().__init__()
        import ctypes
        if Hush._lib is None:
            lib = ctypes.CDLL(str(MODELS / "src" / "hush" / "deployment" / "lib" / "weya_nc.dll"))
            lib.weya_nc_model_load_from_path.argtypes = [ctypes.c_char_p]
            lib.weya_nc_model_load_from_path.restype = ctypes.c_void_p
            lib.weya_nc_session_create.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_float]
            lib.weya_nc_session_create.restype = ctypes.c_void_p
            lib.weya_nc_session_free.argtypes = [ctypes.c_void_p]
            lib.weya_nc_get_frame_length.argtypes = [ctypes.c_void_p]
            lib.weya_nc_get_frame_length.restype = ctypes.c_size_t
            lib.weya_nc_process_frame.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.POINTER(ctypes.c_float)]
            lib.weya_nc_process_frame.restype = ctypes.c_float
            Hush._lib = lib
            Hush._model = lib.weya_nc_model_load_from_path(str(MODELS / "hush" / "advanced_dfnet16k_model_best_onnx.tar.gz").encode("utf-8"))
            if not Hush._model:
                raise RuntimeError("weya_nc could not load the model bundle")
        self._ct = ctypes
        self.sess = Hush._lib.weya_nc_session_create(Hush._model, 16000, 100.0)
        assert Hush._lib.weya_nc_get_frame_length(self.sess) == self.hop
        self.out = np.zeros(self.hop, np.float32)

    def _hop(self, x):
        frame = np.ascontiguousarray(x, np.float32)
        fp = self._ct.POINTER(self._ct.c_float)
        Hush._lib.weya_nc_process_frame(self.sess, frame.ctypes.data_as(fp), self.out.ctypes.data_as(fp))
        return self.out.copy()

    def __del__(self):
        if getattr(self, "sess", None):
            Hush._lib.weya_nc_session_free(self.sess)
            self.sess = None


ONNX_ENGINES = {"gtcrn": Gtcrn, "dtln": Dtln, "dpdfnet2": Dpdfnet, "dpdfnet2_48k": Dpdfnet48, "hush": Hush}


def model_files(engine):
    return {"gtcrn": ["gtcrn/gtcrn_simple.onnx"], "dtln": ["dtln/model_1.onnx", "dtln/model_2.onnx"],
            "dpdfnet2": ["dpdfnet2/dpdfnet2.onnx"], "dpdfnet2_48k": ["dpdfnet2_48k/dpdfnet2_48khz_hr.onnx"]}[engine]
