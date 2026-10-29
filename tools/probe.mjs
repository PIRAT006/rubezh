// tools/probe.mjs — быстрый интерактивный прогон + произвольный JS
import fs from 'node:fs';
import path from 'node:path';
import { launch, CDP, newTarget, sleep, ROOT } from './harness.mjs';

const URL_BASE = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
const expr = process.env.EXPR || '1+1';
const waitMs = Number(process.env.WAIT || 3000);
const shot = process.env.SHOT || '';
const query = process.env.Q || '';

const proc = await launch();
try {
  const target = await newTarget('about:blank');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  cdp.on('Runtime.consoleAPICalled', p => {
    const text = p.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
    if (p.type === 'error' || text.startsWith('[TEST]')) console.log(`[${p.type}] ${text}`);
  });
  cdp.on('Runtime.exceptionThrown', p => console.log('[EXC]', p.exceptionDetails.text, p.exceptionDetails.exception?.description));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_BASE + (query ? '?' + query : '') });
  await sleep(waitMs);

  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.exceptionDetails).slice(0, 800));
  console.log(JSON.stringify(r.result.value, null, 1));

  if (shot) {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, shot), Buffer.from(s.data, 'base64'));
    console.log('shot ->', shot);
  }
} catch (e) {
  console.error('FAIL', e);
} finally {
  try { proc.kill(); } catch { }
  await sleep(300);
  process.exit(0);
}