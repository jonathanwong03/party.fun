// Reject if `promise` doesn't settle within `ms`, so a hung external dependency (Gemini, an HTTP
// call) can't tie up a request forever. The timer is always cleared on settle, so it never leaks
// and never keeps the event loop alive. Callers keep their own degrade-gracefully behaviour by
// catching the rejection (e.g. embeddings fall back to null).
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
