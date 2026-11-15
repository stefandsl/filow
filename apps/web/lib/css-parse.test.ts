import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { expect, it } from 'vitest';

// Every stylesheet in the repository must parse, and no comment may hold another "/*":
// a block pasted inside a comment ends that comment early, and the rest of the comment
// becomes CSS that breaks `next build` while dev and the unit tests still pass.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const files = execFileSync('git', ['ls-files', '*.css'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

it('finds the stylesheets', () => {
  expect(files).toContain('apps/web/app/okfilow/whiteboard/whiteboard.css');
});

it.each(files)('%s parses and has no comment inside a comment', file => {
  const css = readFileSync(root + file, 'utf8');
  const sheet = postcss.parse(css, { from: file });
  sheet.walkComments(c => {
    expect(c.text, `${file}:${c.source?.start?.line}`).not.toContain('/*');
  });
});
