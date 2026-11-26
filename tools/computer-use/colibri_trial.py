"""Launch settings for the dev-only Inkling grounding trial. No process starts on import."""

IMAGE_TILES = 576
JOB_LIMIT_BYTES = 16 * 1024**3


def server_settings(model_dir, port, *, cpu=False, capped=False, tiles=IMAGE_TILES):
    """Return arguments for coli and environment overrides for its vision gateway.

    --cap sets expert cache slots per layer. The caller must independently
    enforce JOB_LIMIT_BYTES on the process tree for a memory-capped trial.
    """
    if not 1024 <= port <= 65535 or port in (4747, 4748, 11434):
        raise ValueError("Invalid local trial port")
    if tiles not in (256, IMAGE_TILES, 1296):
        raise ValueError("Unknown trial image budget")
    args = ["serve", "--model", str(model_dir), "--host", "127.0.0.1", "--port", str(port),
            "--ctx", "4096", "--kv-slots", "1", "--no-think", "--model-id", "inkling-2-mini-colibri"]
    if capped:
        args.extend(["--cap", "16"])
    if cpu:
        args.extend(["--gpu", "none"])
    env = {"INK2_MAX_IMAGE_TOKENS": str(tiles), "COLI_VULKAN": "0" if cpu else "1",
           "NOGPU": "1" if cpu else "0"}
    return args, env
