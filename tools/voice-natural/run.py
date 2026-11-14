"""Run one task with a hard timeout; write all logs/caches under the task root."""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('G:/FILOW/tmp/voice-natural')
env = os.environ.copy()
for key, suffix in {'TEMP': 'temp', 'TMP': 'temp', 'HF_HOME': 'hf', 'TORCH_HOME': 'torch',
                    'PIP_CACHE_DIR': 'pip', 'npm_config_cache': 'npm-cache',
                    'ELECTRON_CACHE': 'electron', 'XDG_CACHE_HOME': 'cache',
                    'FILOW_TEST_TMP': 'tests', 'NODE_COMPILE_CACHE': 'node-compile-cache'}.items():
    folder = ROOT / suffix
    folder.mkdir(parents=True, exist_ok=True)
    env[key] = str(folder)
env['PYTHONDONTWRITEBYTECODE'] = '1'
env['FILOW_QA_NO_GLOBAL_INPUT'] = '1'
env['FILOW_QA_HEADLESS'] = '1'
timeout, log, *command = sys.argv[1:]
with (ROOT / log).open('w', encoding='utf-8') as output:
    process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=env,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        code = process.wait(timeout=float(timeout))
    except subprocess.TimeoutExpired:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=output, stderr=subprocess.STDOUT, timeout=15)
        process.wait(timeout=15)
        raise SystemExit('Hard timeout: ' + log)
raise SystemExit(code)
