const path = require("node:path");
const { spawn } = require("node:child_process");
const { isolatedOllamaUrl } = require("../../../apps/desktop/localai");

function testLaunchEnv(env) {
  if (!env?.FILOW_USER_DATA_DIR || !path.isAbsolute(env.FILOW_USER_DATA_DIR)) throw Error("Test launch needs an absolute profile");
  for (const port of [env.FILOW_PORT, env.FILOW_SESSION_PORT, ...(env.FILOW_HTTPS_PORT ? [env.FILOW_HTTPS_PORT] : [])]) {
    if (!/^\d+$/.test(port) || !isolatedOllamaUrl("http://127.0.0.1:" + port)) throw Error("Test launch needs private ports");
  }
  const disabled = "http://127.0.0.1:0";
  const url = env.OLLAMA_URL || disabled;
  if (url !== disabled && !isolatedOllamaUrl(url)) throw Error("Unsafe test Ollama endpoint");
  return { ...env, OLLAMA_URL: url, OLLAMA_HOST: new URL(url).host };
}

function spawnTestApp(command, args, options) {
  return spawn(command, args, { ...options, env: testLaunchEnv(options.env) });
}
module.exports = { spawnTestApp, testLaunchEnv };
