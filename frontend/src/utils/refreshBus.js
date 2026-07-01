const listeners = new Set();

export function onGlobalRefresh(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function triggerGlobalRefresh() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error("Global refresh listener failed:", err);
    }
  });
}
