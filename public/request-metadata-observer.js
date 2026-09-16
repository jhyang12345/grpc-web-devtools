(() => {
  "use strict";

  const STATE_KEY = Symbol.for("grpc-web-inspector.request-metadata-observer");
  if (window[STATE_KEY]) return;

  // Same explicit allowlist as CAPTURED_METADATA_KEYS in the other three
  // interceptors — never widen this to capture headers wholesale (Authorization
  // rides alongside these on every real request).
  const CAPTURED_METADATA_KEYS = ["app-version", "service-name"];

  const state = { lastMeta: undefined };
  Object.defineProperty(window, STATE_KEY, { configurable: true, value: state });

  // Every RPC library's own interceptor chain sits above the actual fetch/XHR
  // call it eventually makes. If an app attaches a header via logic that runs
  // "inside" that library's own transport (closer to the wire than wherever our
  // per-transport interceptors read metadata), we can't see it from up there —
  // it only exists once the real network call fires. Patching fetch/XHR here
  // observes exactly what actually got sent, regardless of which library or
  // interceptor ordering produced it.
  function extractAllowlistedHeaders(headersLike) {
    if (!headersLike) return undefined;
    let headers;
    try {
      headers = headersLike instanceof Headers ? headersLike : new Headers(headersLike);
    } catch (_) {
      return undefined;
    }
    const result = {};
    CAPTURED_METADATA_KEYS.forEach(key => {
      const value = headers.get(key);
      if (typeof value === "string" && value && value.length <= 512) result[key] = value;
    });
    return Object.keys(result).length && new TextEncoder().encode(JSON.stringify(result)).length <= 2048 ? result : undefined;
  }

  function record(headersLike) {
    const meta = extractAllowlistedHeaders(headersLike);
    state.lastMeta = meta;
  }

  // Deliberately a single slot, not keyed by URL: a transport's own "method"
  // string handed to our interceptors isn't guaranteed to match the final
  // absolute URL actually dispatched (it may be a relative path, or built up
  // internally by the client). Every interceptor instead reads this exactly
  // once, synchronously, immediately after triggering the real transport call
  // — with no `await`/microtask in between — so it always corresponds to
  // exactly that call's own dispatch. JS's single-threaded execution model
  // guarantees no other call's fetch/XHR can interleave inside that narrow
  // synchronous window, so this is race-free even for overlapping requests.
  window.__GRPCWEB_DEVTOOLS_TAKE_LAST_REQUEST_META__ = () => {
    const value = state.lastMeta;
    state.lastMeta = undefined;
    return value;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      try {
        const headers = (init && init.headers) || (input && typeof input === "object" ? input.headers : undefined);
        record(headers);
      } catch (_) {
        // Observation must never affect the real request.
      }
      return originalFetch.apply(this, arguments);
    };
  }

  const XHRProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHRProto) {
    const metadataByXhr = new WeakMap();
    const originalOpen = XHRProto.open;
    const originalSetRequestHeader = XHRProto.setRequestHeader;
    const originalSend = XHRProto.send;

    XHRProto.open = function () {
      const result = originalOpen.apply(this, arguments);
      metadataByXhr.delete(this);
      return result;
    };

    XHRProto.setRequestHeader = function (name, value) {
      // Preserve native validation/exceptions; never retain a rejected header.
      const result = originalSetRequestHeader.apply(this, arguments);
      if (typeof name !== "string" || typeof value !== "string") return result;
      const key = name.toLowerCase();
      if (!CAPTURED_METADATA_KEYS.includes(key)) return result;
      const meta = metadataByXhr.get(this) || {};
      // Native XHR appends repeated headers. An oversized field remains
      // omitted until open() starts the next request, even after more appends.
      if (meta[key] !== null) {
        const next = meta[key] === undefined ? value.trim() : `${meta[key]}, ${value.trim()}`;
        meta[key] = next.length <= 512 ? next : null;
      }
      metadataByXhr.set(this, meta);
      return result;
    };

    XHRProto.send = function () {
      try {
        const stored = metadataByXhr.get(this) || {};
        const meta = {};
        CAPTURED_METADATA_KEYS.forEach(key => {
          if (typeof stored[key] === "string") meta[key] = stored[key];
        });
        record(meta);
      } catch (_) {
        // Observation must never affect the real request.
      }
      return originalSend.apply(this, arguments);
    };
  }
})();
