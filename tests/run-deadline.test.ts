import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyRunDeadline} from '../src/run-deadline.js';

test('host deadline rejects invalid values and aborts expired runs before dispatch', () => {
  const controller = new AbortController();
  assert.throws(() => applyRunDeadline(controller, 'tomorrow'), /Invalid/);
  applyRunDeadline(controller, '2000-01-01T00:00:00Z');
  assert.equal(controller.signal.aborted, true);
  assert.match(String(controller.signal.reason), /deadline/);
});

test('host deadline cancels ongoing work, and disposal leaves another run active', async () => {
  const active = new AbortController(), disposed = new AbortController();
  const end = new Date(Date.now() + 30).toISOString();
  applyRunDeadline(active, end);
  applyRunDeadline(disposed, end)();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(active.signal.aborted, true);
  assert.equal(disposed.signal.aborted, false);
});
