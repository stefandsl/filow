import fs from 'node:fs';
import { expect, it } from 'vitest';

it('launches the packaged window normally and records proof of the Save action', () => {
  const harness = fs.readFileSync('tools/release/about-and-save.ps1','utf8');
  const launch = harness.split('$app = Start-Process')[1].split('$result.pid')[0];
  expect(launch).not.toContain('Hidden');
  for (const item of ['savedReportSha256','screenshot','startupLog']) expect(harness).toContain('$result.' + item);
  expect(fs.readFileSync('tools/release/acceptance-ui.mjs','utf8')).toContain('Page.captureScreenshot');
});
