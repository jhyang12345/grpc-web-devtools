// This file is a static ISOLATED-world content script, never a page injection.
// Only this extension's DevTools context may call the API via isolated eval.
(() => {
  if (window !== window.top) return;
  const newDocumentId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  let documentId = newDocumentId();
  let pending = null;
  const cancel = () => {
    if (!pending) return;
    pending.controller.abort();
    clearTimeout(pending.timer);
    pending = null;
  };
  Object.defineProperty(globalThis, '__GRPCWEB_DEVTOOLS_BTS__', { value: Object.freeze({
    context: () => documentId ? { documentId, origin: location.origin } : null,
    start: (binding, id, fetchAccount) => {
      if (!documentId || binding.documentId !== documentId || binding.initiatorOrigin !== location.origin || pending) return false;
      const attempt = { id, controller: new AbortController(), done: false, result: null };
      pending = attempt;
      attempt.timer = setTimeout(cancel, 4500);
      Promise.resolve().then(() => fetchAccount(binding, attempt.controller.signal)).then(result => {
        if (pending === attempt) { attempt.result = result; attempt.done = true; }
      }, () => {
        if (pending === attempt) attempt.done = true;
      });
      return true;
    },
    take: id => {
      if (!pending || pending.id !== id) return { done: true, result: null };
      if (!pending.done) return { done: false };
      const result = pending.result;
      cancel();
      return { done: true, result };
    },
    cancel: id => { if (pending && pending.id === id) cancel(); },
  }) });
  window.addEventListener('pagehide', () => { documentId = null; cancel(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { cancel(); documentId = newDocumentId(); }
  });
})();
