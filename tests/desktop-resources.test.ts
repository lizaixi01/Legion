import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {serveDesktopResource} = require('../desktop/resources.cjs');

test('production protocol serves the complete renderer module graph', async () => {
  const visited = new Set<string>();
  async function visit(url: string): Promise<void> {
    if (visited.has(url)) return;
    visited.add(url);
    const response: Response = serveDesktopResource({url});
    assert.equal(response.status, 200, `Missing renderer resource: ${url}`);
    assert.match(response.headers.get('content-type') || '', /javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      await visit(new URL(match[1]!, url).href);
    }
  }
  await visit('proactive://app/app.js');
  assert.ok(visited.has('proactive://app/drop-files.js'));
  assert.ok(visited.has('proactive://app/attachment-cards.js'));
  assert.ok(visited.has('proactive://app/conversation-view.js'));
  for (const resource of ['/', '/style.css']) {
    assert.equal(serveDesktopResource({url: 'proactive://app' + resource}).status, 200);
  }
});

test('production protocol rejects non-public files and other origins', () => {
  for (const url of ['proactive://app/main.cjs', 'proactive://app/preload.cjs', 'proactive://other/app.js', 'https://app/app.js']) {
    assert.equal(serveDesktopResource({url}).status, 404);
  }
});
