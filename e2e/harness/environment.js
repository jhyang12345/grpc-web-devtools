// Jest environment for the real-library end-to-end suites.
//
// jsdom supplies the DOM, XMLHttpRequest (used by generated grpc-web clients)
// and the React panel, but Jest 27's jsdom has no fetch or web streams. Connect-ES
// and protobuf-ts need both, so this environment lends the test realm Node's own
// WHATWG implementations. AbortController comes from Node as well, because Node's
// fetch rejects signals created by jsdom's implementation.
const JsdomEnvironment = require("jest-environment-jsdom");

const NODE_WEB_GLOBALS = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "TextEncoder",
  "TextDecoder",
  "AbortController",
  "AbortSignal",
  "structuredClone",
  "Blob",
];

class RealLibraryEnvironment extends JsdomEnvironment {
  constructor(config, context) {
    super(config, context);
    NODE_WEB_GLOBALS.forEach(name => {
      if (typeof globalThis[name] !== "undefined") this.global[name] = globalThis[name];
    });
    // Node's streams and fetch create Uint8Arrays in the outer realm; protobuf
    // runtimes use `instanceof Uint8Array` checks, so share the same constructors.
    ["Uint8Array", "ArrayBuffer", "DataView"].forEach(name => {
      this.global[name] = globalThis[name];
    });

    // In a browser, fetch rejects with the page realm's TypeError. Node's fetch
    // rejects with the outer realm's, which would defeat `instanceof TypeError`
    // checks in the page interceptors. Re-throw network failures in-realm.
    const pageGlobal = this.global;
    this.global.fetch = (...args) => globalThis.fetch(...args).catch(error => {
      if (error instanceof globalThis.TypeError) {
        const pageError = new pageGlobal.TypeError(error.message);
        pageError.cause = error.cause;
        throw pageError;
      }
      throw error;
    });

    // Every browser defines the CSS namespace; jsdom does not, and the panel's
    // `CSS?.highlights` check would throw a ReferenceError on the bare identifier.
    if (!this.global.CSS) this.global.CSS = { supports: () => false, escape: value => String(value) };

    // XHR spec: `response` for an "arraybuffer" responseType is null until the
    // request is DONE. jsdom returns the partial body while LOADING, which makes
    // grpc-web's binary mode re-parse (and re-emit) earlier stream messages.
    const xhrPrototype = this.global.XMLHttpRequest.prototype;
    const responseDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, "response");
    Object.defineProperty(xhrPrototype, "response", {
      ...responseDescriptor,
      get() {
        if (this.responseType === "arraybuffer" && this.readyState !== 4) return null;
        return responseDescriptor.get.call(this);
      },
    });
  }
}

module.exports = RealLibraryEnvironment;
