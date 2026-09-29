/** Apply an optional host deadline without changing per-worker budgets. */
export function applyRunDeadline(controller: AbortController, value?: string): () => void {
  if (!value) return () => {};
  const deadline = Date.parse(value);
  const remaining = deadline - Date.now();
  if (!Number.isFinite(deadline) || remaining > 2_147_483_647) {
    throw new Error('Invalid PROACTIVE_RUN_DEADLINE; use a near-term ISO timestamp');
  }
  const abort = () => controller.abort(new Error('Host run deadline reached'));
  if (remaining <= 0) { abort(); return () => {}; }
  const timer = setTimeout(abort, remaining);
  timer.unref();
  return () => clearTimeout(timer);
}
