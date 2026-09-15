import { buildOpUserEvalExpression } from './opUserRawFetch';

const LEASE_MS = 5 * 60 * 1000;
const CONTEXT = 'globalThis.__GRPCWEB_DEVTOOLS_BTS__';

// Only call with an entry delivered directly by Chrome's network API. Page
// capture events, Redux entries and imported/preserved logs are NOT evidence.
function credentialFromNetwork(entry, since, now) {
  const request = entry?.request;
  const response = entry?.response;
  if (request?.method !== 'POST' || !Array.isArray(request.headers) || request.headers.length > 128 ||
      !response || response.status < 200 || response.status >= 300 || !Number.isFinite(response.status) ||
      response._fetchedViaServiceWorker !== false || response._error || entry._fromCache) return null;
  const startedAt = Date.parse(entry.startedDateTime);
  if (!Number.isFinite(startedAt) || startedAt < since || startedAt > now || now - startedAt >= LEASE_MS) return null;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !/^\/[A-Za-z_][A-Za-z0-9_.]*\/[A-Za-z_][A-Za-z0-9_]*$/.test(url.pathname) ||
        url.pathname === '/opgwv1.OpGw/GetOpUser') return null; // Never renew our own lease.
    const headers = {};
    for (const header of request.headers) {
      const name = typeof header.name === 'string' ? header.name.toLowerCase() : '';
      if (!['authorization', 'origin', 'content-type'].includes(name)) continue;
      if (Object.prototype.hasOwnProperty.call(headers, name) || typeof header.value !== 'string' || header.value.length > 8192) return null;
      headers[name] = header.value;
    }
    if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(headers.authorization || '') ||
        !/^application\/grpc-web(?:-text)?(?:\+proto|\+json)?(?:;|$)/i.test(headers['content-type'] || '')) return null;
    const initiator = new URL(headers.origin);
    if (!['http:', 'https:'].includes(initiator.protocol) || initiator.origin !== headers.origin) return null;
    return { apiOrigin: url.origin, authorization: headers.authorization, initiatorOrigin: initiator.origin,
      startedAt, expiresAt: startedAt + LEASE_MS };
  } catch (_) { return null; }
}

export function createBrowserBoundAccount(devtools, now = Date.now) {
  let running = false;
  let generation = 0;
  let since = now();
  let credential = null;
  let expiryTimer = null;
  let inFlight = null;
  let sequence = 0;

  function evaluate(expression) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 1000);
      try {
        devtools.inspectedWindow.eval(expression, { useContentScriptContext: true }, (value, exception) => {
          clearTimeout(timer);
          resolve(exception ? null : value);
        });
      } catch (_) { clearTimeout(timer); resolve(null); }
    });
  }

  function reset() {
    generation += 1;
    since = now();
    credential = null;
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  async function observe(entry) {
    const revision = generation;
    const candidate = credentialFromNetwork(entry, since, now());
    if (!running || !candidate) return;
    const context = await evaluate(`${CONTEXT}?.context()`);
    if (!running || revision !== generation || !context?.documentId || context.origin !== candidate.initiatorOrigin ||
        now() >= candidate.expiresAt || (credential && credential.startedAt > candidate.startedAt)) return;
    credential = { ...candidate, documentId: context.documentId };
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { credential = null; expiryTimer = null; }, candidate.expiresAt - now());
  }

  async function fetchAccount() {
    const revision = generation;
    const binding = credential;
    if (!running || !binding || now() >= binding.expiresAt) return null;
    const context = await evaluate(`${CONTEXT}?.context()`);
    if (revision !== generation || !context || context.documentId !== binding.documentId || context.origin !== binding.initiatorOrigin) {
      if (revision === generation) reset();
      return null;
    }
    const attemptId = `${generation}-${++sequence}`;
    let result = null;
    try {
      if (await evaluate(buildOpUserEvalExpression(binding, attemptId)) !== true) return null;
      // inspectedWindow.eval does not await returned Promises. Start once,
      // then retrieve bounded synchronous results from the isolated world.
      const deadline = now() + 5000;
      for (let poll = 0; poll < 50 && now() < deadline && revision === generation && running; poll += 1) {
        const reply = await evaluate(`${CONTEXT}?.take(${JSON.stringify(attemptId)})`);
        if (!reply || reply.done) { result = reply?.result || null; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      await evaluate(`${CONTEXT}?.cancel(${JSON.stringify(attemptId)})`);
    }
    return revision === generation && running ? result : null;
  }

  return {
    start() {
      if (running || !devtools?.network?.onRequestFinished || !devtools?.network?.onNavigated || !devtools?.inspectedWindow?.eval) return;
      running = true;
      reset();
      devtools.network.onRequestFinished.addListener(observe);
      devtools.network.onNavigated.addListener(reset);
    },
    stop() {
      if (running) {
        devtools.network.onRequestFinished.removeListener(observe);
        devtools.network.onNavigated.removeListener(reset);
      }
      running = false;
      reset();
    },
    fetch() {
      if (!inFlight) inFlight = fetchAccount().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

let client = null;
export function startBrowserBoundAccount(devtools) {
  if (client) client.stop();
  client = createBrowserBoundAccount(devtools);
  client.start();
}
export function stopBrowserBoundAccount() { if (client) client.stop(); client = null; }
export function fetchBrowserBoundAccount() { return client ? client.fetch() : Promise.resolve(null); }
