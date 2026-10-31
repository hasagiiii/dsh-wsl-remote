// Drive a page in Chrome through the DevTools protocol (CDP), for checking the real client.
//   chrome --headless=new --remote-debugging-port=<port> --user-data-dir=<dir> about:blank
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" test/cdp.mjs <port> <steps.mjs>
// The steps module's default export receives { send, evaluate, shot, sleep, click, clickText, logs }.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [port, file] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((done) => ws.addEventListener('open', done, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) logs.push(`[${message.params.type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
  if (message.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
});
const send = (method, params = {}) => new Promise((done, fail) => {
  const n = ++id;
  pending.set(n, (message) => (message.error ? fail(new Error(`${method}: ${message.error.message}`)) : done(message.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const shot = async (path) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const click = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
/** Click the first visible element matching `selector` whose trimmed text matches `pattern` (a RegExp source). */
const clickText = async (pattern, selector = 'button,[role=menuitem],[role=option]') => {
  const point = await evaluate(`(() => { const re = new RegExp(${JSON.stringify(pattern)}); const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.offsetParent !== null && re.test(e.textContent.trim())); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (point) await click(point.x, point.y);
  return point;
};
const steps = await import(pathToFileURL(resolve(file)).href);
try {
  await steps.default({ send, evaluate, shot, sleep, click, clickText, logs });
} finally {
  if (logs.length > 0) console.log(`--- page errors/warnings ---\n${logs.slice(-15).map((line) => line.slice(0, 400)).join('\n')}`);
  ws.close();
}
