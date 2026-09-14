(() => {
  "use strict";

  const STATE_KEY = Symbol.for("grpc-web-inspector.request-metadata-snoop");
  if (window[STATE_KEY]) return;

  // Same explicit allowlist as CAPTURED_METADATA_KEYS in the other three
  // interceptors — never widen this to capture headers wholesale (Authorization
  // rides alongside these on every real request).
  const CAPTURED_METADATA_KEYS = ["app-version", "service-name"];
  const MAX_ENTRIES = 50;
  const ENTRY_TTL_MS = 30000;

  const state = { byUrl: new Map() };
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
      if (typeof value === "string" && value) result[key] = value;
    });
    return Object.keys(result).length ? result : undefined;
  }

  function record(url, headersLike) {
    if (typeof url !== "string" || !url) return;
    const meta = extractAllowlistedHeaders(headersLike);
    if (!meta) return;
    state.byUrl.set(url, { meta, recordedAt: Date.now() });
    if (state.byUrl.size > MAX_ENTRIES) state.byUrl.delete(state.byUrl.keys().next().value);
  }

  // Single-use: consuming a lookup removes it, so a stale or misattributed
  // entry can't silently linger and leak onto some unrelated later request to
  // the same URL.
  window.__GRPCWEB_DEVTOOLS_TAKE_REQUEST_META__ = url => {
    const entry = state.byUrl.get(url);
    if (!entry) return undefined;
    state.byUrl.delete(url);
    if (Date.now() - entry.recordedAt > ENTRY_TTL_MS) return undefined;
    return entry.meta;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : (input && input.url);
        const headers = (init && init.headers) || (input && typeof input === "object" ? input.headers : undefined);
        record(url, headers);
      } catch (_) {
        // Observation must never affect the real request.
      }
      return originalFetch.apply(this, arguments);
    };
  }

  const XHRProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHRProto) {
    const originalOpen = XHRProto.open;
    const originalSetRequestHeader = XHRProto.setRequestHeader;
    const originalSend = XHRProto.send;

    XHRProto.open = function (method, url) {
      this.__grpcWebDevtoolsUrl = url;
      this.__grpcWebDevtoolsHeaders = undefined;
      return originalOpen.apply(this, arguments);
    };

    XHRProto.setRequestHeader = function (name, value) {
      this.__grpcWebDevtoolsHeaders = this.__grpcWebDevtoolsHeaders || {};
      this.__grpcWebDevtoolsHeaders[name] = value;
      return originalSetRequestHeader.apply(this, arguments);
    };

    XHRProto.send = function () {
      try {
        record(this.__grpcWebDevtoolsUrl, this.__grpcWebDevtoolsHeaders);
      } catch (_) {
        // Observation must never affect the real request.
      }
      return originalSend.apply(this, arguments);
    };
  }
})();
