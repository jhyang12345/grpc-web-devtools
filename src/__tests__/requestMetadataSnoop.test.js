const fs = require("fs");
const path = require("path");

const loadSnoop = () => {
  const source = fs.readFileSync(path.join(__dirname, "../../public/request-metadata-snoop.js"), "utf8");
  window.eval(source);
};

const takeLast = () => window.__GRPCWEB_DEVTOOLS_TAKE_LAST_REQUEST_META__();

// The snoop patches window.fetch / XMLHttpRequest.prototype once, guarded by
// a Symbol.for(...) key (matching the other interceptors' idempotency
// pattern) — so it's installed once here and every test below just exercises
// the already-installed wrapper.
beforeAll(() => {
  window.fetch = jest.fn().mockResolvedValue({ ok: true });
  loadSnoop();
});

test("captures only the allowlisted app-version/service-name headers from a fetch call, never authorization", async () => {
  await window.fetch("https://api.example.test/demo.Service/GetThing", {
    method: "POST",
    headers: {
      Authorization: "bearer super-secret-token",
      "App-Version": "qa-af32a43",
      "Service-Name": "example-service",
      "Instance-Id": "instance-42",
    },
  });

  expect(takeLast()).toEqual({
    "app-version": "qa-af32a43",
    "service-name": "example-service",
  });
});

test("captures headers from a Request object argument as well as a plain URL string", async () => {
  const request = new Request("https://api.example.test/demo.Service/RequestObject", {
    headers: { "app-version": "qa-b91c2d0" },
  });

  await window.fetch(request);

  expect(takeLast()).toEqual({ "app-version": "qa-b91c2d0" });
});

test("captures only the allowlisted headers set on an XMLHttpRequest, never authorization", () => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://api.example.test/demo.Service/XhrThing");
  xhr.setRequestHeader("Authorization", "bearer super-secret-token");
  xhr.setRequestHeader("App-Version", "qa-af32a43");
  xhr.send();

  expect(takeLast()).toEqual({ "app-version": "qa-af32a43" });
});

test("returns undefined and never throws when no allowlisted header was sent", async () => {
  await window.fetch("https://api.example.test/demo.Service/NoHeaders", { headers: { "x-other": "1" } });
  expect(takeLast()).toBeUndefined();
});

test("is single-use: consuming a lookup clears it so it can't leak onto a later unrelated request", async () => {
  await window.fetch("https://api.example.test/demo.Service/OnceOnly", { headers: { "app-version": "qa-once" } });

  expect(takeLast()).toEqual({ "app-version": "qa-once" });
  expect(takeLast()).toBeUndefined();
});

test("a request with no allowlisted headers does not clobber a still-unconsumed earlier capture", async () => {
  await window.fetch("https://api.example.test/demo.Service/First", { headers: { "app-version": "qa-first" } });
  await window.fetch("https://api.example.test/demo.Service/Second", { headers: { "x-other": "1" } });

  expect(takeLast()).toEqual({ "app-version": "qa-first" });
});

test("loading the script again after startup is a safe no-op and does not double-wrap fetch", async () => {
  expect(() => loadSnoop()).not.toThrow();

  await window.fetch("https://api.example.test/demo.Service/DoubleLoad", { headers: { "app-version": "qa-once" } });
  expect(takeLast()).toEqual({ "app-version": "qa-once" });
});
