// Isolated local integration test. Requires playwright-core and a Chromium
// build that permits --load-extension (e.g. Playwright Chromium).
// No real application, credentials, or existing browser profile is used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const selfsigned = require('selfsigned');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-bts-browser-'));
  const extension = path.join(temp, 'extension');
  // Generate only the temporary test fixture; production sources stay intact.
  fs.cpSync(path.join(root, 'build'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
  manifest.devtools_page = 'probe.html';
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension, 'probe.html'), fs.readFileSync(path.join(extension, 'index.html'), 'utf8')
    .replace('</body>', '<script type="module" src="probe.js"></script></body>'));
  fs.copyFileSync(path.join(root, 'src/utils/opUserRawFetch.js'), path.join(extension, 'opUserRawFetch.js'));
  fs.writeFileSync(path.join(extension, 'browserBoundAccount.js'),
    fs.readFileSync(path.join(root, 'src/utils/browserBoundAccount.js'), 'utf8').replace("'./opUserRawFetch'", "'./opUserRawFetch.js'"));
  fs.writeFileSync(path.join(extension, 'probe.js'), `
    import { createBrowserBoundAccount } from './browserBoundAccount.js';
    globalThis.client = createBrowserBoundAccount(chrome.devtools);
    client.start();
    globalThis.seen = [];
    chrome.devtools.network.onRequestFinished.addListener(e => {
      if (e.request.url.includes('/opgwv1.OpGw/')) seen.push({ url: e.request.url, method: e.request.method,
        auth: e.request.headers.some(h => h.name.toLowerCase() === 'authorization'),
        origin: e.request.headers.some(h => h.name.toLowerCase() === 'origin'),
        sw: e.response._fetchedViaServiceWorker });
    });
  `);

  const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048 });
  const requests = [];
  let redirect = false;
  let appOrigin;
  const api = https.createServer({ key: certificate.private, cert: certificate.cert }, (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', appOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-grpc-web');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    requests.push({ path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (redirect && req.url === '/opgwv1.OpGw/GetOpUser') {
      res.writeHead(302, { Location: `${appOrigin}/redirect-target` }); res.end(); return;
    }
    const email = Buffer.from('browser-test@example.test');
    const payload = Buffer.concat([Buffer.from([58, email.length]), email]);
    res.setHeader('Content-Type', 'application/grpc-web+proto');
    res.end(Buffer.concat([Buffer.from([0, 0, 0, 0, payload.length]), payload]));
  });
  let redirectedRequests = 0;
  const app = https.createServer({ key: certificate.private, cert: certificate.cert }, (req, res) => {
    if (req.url === '/redirect-target') redirectedRequests += 1;
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(`self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => { if(e.request.url.includes('/GetOpUser')) {
          e.respondWith(new Response('intercepted', {status: 500}));
        }});`);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>BTS isolated browser test</title><body>Local security test</body>');
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  appOrigin = `https://127.0.0.1:${app.address().port}`;
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `https://127.0.0.1:${api.address().port}`;
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--auto-open-devtools-for-tabs', '--ignore-certificate-errors'],
    });
    const page = context.pages()[0];
    const cdp = await context.newCDPSession(page);
    await page.goto(appOrigin);
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url.endsWith('/probe.html')), 'DevTools extension target');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let nextId = 0;
    const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      const operation = pending.get(message.id);
      if (operation) { pending.delete(message.id); message.error ? operation.reject(new Error(JSON.stringify(message.error))) : operation.resolve(message.result); }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await until(() => evaluate('typeof client !== "undefined"'), 'account observer');
    await evaluate(`globalThis.evalAudit = [];
      const originalEval = chrome.devtools.inspectedWindow.eval;
      chrome.devtools.inspectedWindow.eval = (expression, options, callback) => {
        if (typeof options === 'function') return originalEval(expression, options);
        originalEval(expression, options, (value, error) => {
          evalAudit.push({phase:expression.includes('.start(')?'start':expression.includes('.context(')?'context':'poll',
            error:error?.description || error?.value || null, value:typeof value === 'boolean'?value:null});
          callback(value,error);
        });
      };`);
    assert.equal(await evaluate('client.fetch()'), null);
    await page.evaluate(origin => {
      document.cookie = 'fake-accessToken=DO_NOT_READ; SameSite=None; Secure';
      window.postMessage({ type: '__GRPCWEB_DEVTOOLS__', backendUrl: origin + '/evil', meta: { authorization: 'Bearer forged' } }, '*');
    }, appOrigin);
    assert.equal(await evaluate('client.fetch()'), null);
    assert.equal(requests.length, 0);

    const authenticate = () => page.evaluate(async origin => {
      const result = await fetch(`${origin}/opgwv1.OpGw/ListZones`, { method: 'POST', headers: {
        Authorization: 'Bearer LOCAL_TEST_TOKEN', 'Content-Type': 'application/grpc-web+proto',
      }, body: new Uint8Array([0, 0, 0, 0, 0]) });
      await result.arrayBuffer();
    }, apiOrigin);
    await authenticate();
    try {
      await until(() => evaluate('seen.some(e => e.method === "POST" && e.url.endsWith("/ListZones"))'), 'browser HAR');
    } catch (error) {
      console.log({ seen: await evaluate('seen'), serverPaths: requests.map(r => r.path) }); throw error;
    }
    await delay(200);
    const headers = await evaluate('seen.find(e => e.method === "POST" && e.url.endsWith("/ListZones"))');
    assert.equal(headers.auth, true); assert.equal(headers.origin, true); assert.equal(headers.sw, false);
    // A hostile main-world fetch cannot intercept isolated-world credentials.
    await page.evaluate(() => { window.fetch = () => { window.pageFetchCalled = true; throw new Error('page hook'); }; });
    assert.equal((await evaluate('client.fetch()')).email, 'browser-test@example.test');
    assert.equal(await page.evaluate(() => !!window.pageFetchCalled), false);
    assert.equal(requests.at(-1).path, '/opgwv1.OpGw/GetOpUser');
    assert.equal(requests.at(-1).authorization, 'Bearer LOCAL_TEST_TOKEN');
    assert.equal(requests.at(-1).cookie, undefined);
    console.log('PASS: real HAR Authorization + Origin; forged capture ignored; isolated fallback; no cookie forwarding.');

    const beforeShortcut = requests.length;
    await evaluate('evalAudit.length = 0');
    // Do not write to the user's OS clipboard from a headless test. The real
    // component/helper still runs; capture its output at the browser API edge.
    await evaluate('Object.defineProperty(navigator, "clipboard", {value:{writeText:async text => {globalThis.copiedReport = text;}}})');
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {code:"KeyB",ctrlKey:true,altKey:true}))');
    try {
      await until(() => evaluate('!!document.querySelector(".bts-easter-egg")'), 'production shortcut popup');
    } catch (error) {
      console.log({ productionRequests: requests.slice(beforeShortcut).map(r => r.path),
        evalAudit: await evaluate('evalAudit'),
        ui: await evaluate('({root:!!document.querySelector("#root")?.firstChild, text:document.body.innerText.slice(0,300)})') });
      throw error;
    }
    assert.ok(requests.length > beforeShortcut);
    assert.equal(requests.at(-1).authorization, 'Bearer LOCAL_TEST_TOKEN');
    assert.ok((await evaluate('copiedReport')).includes('browser-test@example.test'));
    console.log('PASS: production-minified bundle performs the fallback and displays the Easter egg.');

    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker control');
    assert.equal((await evaluate('client.fetch()')).email, 'browser-test@example.test');
    console.log('PASS: page service worker cannot intercept the isolated fallback.');
    redirect = true;
    assert.equal(await evaluate('client.fetch()'), null);
    assert.equal(redirectedRequests, 0);
    console.log('PASS: redirect rejected before any redirected request.');
    redirect = false;
    await page.goto(`${appOrigin}/next`);
    await delay(200);
    assert.equal(await evaluate('client.fetch()'), null);
    console.log('PASS: navigation invalidates the credential binding.');
    console.log(`Browser: ${context.browser().version()}`);
  } finally {
    if (context) await context.close();
    await Promise.all([new Promise(resolve => api.close(resolve)), new Promise(resolve => app.close(resolve))]);
    console.log(`Temporary test artifacts: ${temp}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
