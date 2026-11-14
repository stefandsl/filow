// Deterministic hidden Stop/Resume regression. This is not a model-latency sample.
export async function runStopResume({ context, withLaunch, clearHistory, typeQuestion, qaKey, signal, until, sleep, fs, path, WORK, say, parseTimings }) {
  const ctx = await context("standard", "stop-resume");
  const result = { stopThinking: false, stopSpeaking: false, resumed: false, resumedRequest: false, noOutputAfterStop: false };
  try {
    await withLaunch(ctx, {}, async () => {
      const page = ctx.page;
      await clearHistory(page);
      await page.evaluate(`(() => {
        const real = window.fetch.bind(window);
        window.__regression = { delay: 2500, resumes: 0 };
        window.fetch = async (url, init) => {
          if (!String(url).includes('/api/buddy/ask')) return real(url, init);
          const request = JSON.parse(init.body);
          if (request.resume) window.__regression.resumes++;
          const delay = window.__regression.delay;
          let timer, closed = false;
          const stream = new ReadableStream({ start(controller) {
            const cancel = () => { if (!closed) { closed = true; clearTimeout(timer); controller.error(new DOMException('Aborted', 'AbortError')); } };
            init.signal?.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => {
              if (closed) return;
              controller.enqueue(new TextEncoder().encode(request.resume ? 'The next step is to check the invoice carefully. ' : 'The invoice is ready for review. Check the customer name and the total before you send it. '));
              timer = setTimeout(() => { if (!closed) { closed = true; controller.close(); } }, request.resume ? 500 : 15000);
            }, delay);
          } });
          return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
        };
        return true;
      })()`);
      await typeQuestion(page, "Explain the invoice.");
      if (!await until(() => signal(page, "okfFetchAt"), 15000)) throw new Error("no thinking request");
      const thinkingStop = Date.now();
      await qaKey(page, "down", "escape"); await qaKey(page, "up", "escape");
      result.stopThinking = await until(() => signal(page, "okfEnd"), 2000) === "stopped";
      result.thinkingStopTelemetryMs = Date.now() - thinkingStop;
      await page.evaluate("window.__regression.delay = 0; true");
      await typeQuestion(page, "Explain the invoice again.");
      if (!await until(() => signal(page, "okfVoiceAt"), 90000)) throw new Error("no audible sentence");
      await sleep(300);
      const speakingStop = Date.now();
      await qaKey(page, "down", "escape"); await qaKey(page, "up", "escape");
      result.stopSpeaking = await until(() => signal(page, "okfEnd"), 2000) === "stopped";
      result.speakingStopTelemetryMs = Date.now() - speakingStop;
      await sleep(2200);
      const lines = fs.readFileSync(ctx.run.log, "utf8").split(/\r?\n/).slice(ctx.run.fromLine).filter(l => l.includes("timings") && l.includes("stopped"));
      const stopped = lines.map(parseTimings).filter(Boolean).slice(-2);
      result.thinkingStopMs = stopped[0] ? stopped[0].marks.silent - stopped[0].marks.stopAt : null;
      result.speakingStopMs = stopped[1] ? stopped[1].marks.silent - stopped[1].marks.stopAt : null;
      result.noOutputAfterStop = lines.length >= 2 && lines.slice(-2).every(l => /afterStop 0/.test(l));
      const resumeAt = Date.now();
      await qaKey(page, "down", "pause"); await qaKey(page, "up", "pause");
      result.resumedRequest = Boolean(await until(() => page.evaluate("window.__regression.resumes > 0"), 10000));
      const voice = await until(async () => { const v = Number(await signal(page, "okfVoiceAt")); return v >= resumeAt ? v : null; }, 90000);
      result.resumeVoiceMs = voice ? Number(voice) - resumeAt : null;
      result.resumed = Boolean(voice) && await until(async () => (await signal(page, "okfEnd")) === "done", 90000) === true;
    });
  } catch (e) { result.error = String(e.message); }
  finally { ctx.sampler.kill(); }
  result.pass = result.stopThinking && result.stopSpeaking && result.resumed && result.resumedRequest && result.noOutputAfterStop && Number.isFinite(result.thinkingStopMs) && result.thinkingStopMs <= 300 && Number.isFinite(result.speakingStopMs) && result.speakingStopMs <= 300 && result.resumeVoiceMs <= 3000;
  fs.writeFileSync(path.join(WORK, "phase2b-stop-resume.json"), JSON.stringify(result, null, 2));
  say(`[stop-resume] ${JSON.stringify(result)}`);
  if (!result.pass) process.exitCode = 1;
}
