// Real-throttle load benchmark. Serves dist/ like GitHub Pages (gzip, short
// cache, HTTP/2 over a throwaway self-signed cert) through a server-side 3G
// pipe shared by the page and its service worker, with CDP CPU throttling.
// Usage: npm run bench:3g -- [fast3g|slow3g] [runs]   (BENCH_VERBOSE=1 for the waterfall)
import { createSecureServer } from "node:http2";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const PROFILES = {
  // Chrome DevTools presets; throughput in bytes/s.
  fast3g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, cpu: 4 },
  slow3g: { latency: 400, downloadThroughput: (400 * 1024) / 8 * 0.8, cpu: 4 },
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const COMPRESSIBLE = new Set([".wasm", ".html", ".js", ".css", ".json", ".svg", ".webmanifest", ".txt", ".xml"]);
const BASE = "/glacier-eq/";
const dist = new URL("../dist", import.meta.url).pathname;
const profileName = process.argv[2] ?? "fast3g";
const runs = Number(process.argv[3] ?? 3);
const net = PROFILES[profileName];
if (!net) throw new Error("profile must be fast3g or slow3g");

const certDir = mkdtempSync(join(tmpdir(), "bench-cert-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(certDir, "k.pem"), "-out", join(certDir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
const server = createSecureServer({ key: await readFile(join(certDir, "k.pem")), cert: await readFile(join(certDir, "c.pem")), allowHTTP1: true }, async (req, res) => {
  const url = new URL(req.url, "https://x");
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let rel = normalize("/" + url.pathname.slice(BASE.length)).slice(1) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  try {
    let body = await readFile(join(dist, rel));
    const ext = extname(rel);
    const headers = { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "max-age=600" };
    if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers["accept-encoding"] ?? "")) {
      body = gzipSync(body, { level: 6 });
      headers["content-encoding"] = "gzip";
    }
    res.writeHead(200, headers);
    // First byte after one RTT; the body then shares the global pipe.
    setTimeout(() => active.push({ res, body, offset: 0, url: rel }), net.latency);
  } catch { res.writeHead(404).end(); }
}).listen(0);

// One shared downlink for every request, page and service worker alike
// (CDP throttling only covers the page). Bandwidth is split round-robin.
const active = [];
const perUrl = new Map();
let served = 0, lastActivity = 0;
const TICK_MS = 10;
setInterval(() => {
  let budget = Math.floor((net.downloadThroughput * TICK_MS) / 1000);
  while (budget > 0 && active.length) {
    const share = Math.max(1, Math.floor(budget / active.length));
    for (const item of [...active]) {
      const n = Math.min(share, item.body.length - item.offset, budget);
      if (n > 0) { item.res.write(item.body.subarray(item.offset, item.offset + n)); served += n; perUrl.set(item.url, (perUrl.get(item.url) ?? 0) + n); lastActivity = Date.now(); }
      item.offset += n;
      budget -= n;
      if (item.offset >= item.body.length) {
        item.res.end();
        active.splice(active.indexOf(item), 1);
      }
    }
  }
}, TICK_MS).unref();
await new Promise((r) => server.once("listening", r));
const origin = `https://localhost:${server.address().port}${BASE}`;

// Pinning the cert's key (instead of ignoring errors) keeps the HTTP cache on;
// Chrome refuses to cache responses served over an ignored certificate error.
const spki = execFileSync("sh", ["-c", `openssl x509 -in ${join(certDir, "c.pem")} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`]).toString().trim();
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${spki}`] });
const results = [];
const waitForApp = (page) =>
  page.waitForFunction(
    () => !document.getElementById("prerender") && document.body?.innerText.includes("No bands yet. The EQ is flat."),
    null,
    { timeout: 180000, polling: 50 },
  );
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: net.cpu });
  let requests = 0, t0s; served = 0;
  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => (t0s ??= e.timestamp, reqs.set(e.requestId, { url: e.request.url.replace(/^.*\/glacier-eq\//, ""), start: Math.round((e.timestamp - t0s) * 1000) })));
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.end = Math.round((e.timestamp - t0s) * 1000); r.kb = +(e.encodedDataLength / 1024).toFixed(1); } requests++; });
  await page.addInitScript(() => {
    window.__m = {};
    // Chrome derives this from real RTT/throughput, which the local server hides.
    Object.defineProperty(navigator, "connection", { value: { effectiveType: "3g", saveData: false } });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__m.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  });
  const t0 = Date.now();
  await page.goto(origin, { waitUntil: "commit" });
  // Visible = the EQ screen is painted, prerendered or live. Playwright's
  // visibility ignores render-blocking CSS, so it cannot be earlier than FCP.
  await page.getByText("No bands yet. The EQ is flat.").filter({ visible: true }).first().waitFor({ timeout: 180000 });
  const domVisible = Date.now() - t0;
  // Interactive = the live app (not the static prerender) shows the empty EQ.
  await waitForApp(page);
  const interactive = Date.now() - t0;
  const m = await page.evaluate(() => window.__m);
  const bytesAtInteractive = served;
  // Everything the browser pulls after the app is usable (service worker precache, wasm).
  while (Date.now() - lastActivity < 1500 && Date.now() - t0 < 300000) await page.waitForTimeout(250);
  const idleAt = Date.now() - t0 - 1500;
  // Repeat visit: service worker is active and the cache is full.
  const warmPage = await ctx.newPage();
  const w0 = Date.now(), wServed = served;
  await warmPage.goto(origin, { waitUntil: "commit" });
  await waitForApp(warmPage);
  const warm = Date.now() - w0, warmKb = Math.round((served - wServed) / 1024);
  results.push({ warm, warmKb, fcp: Math.round(m.fcp), visible: Math.max(domVisible, Math.round(m.fcp)), interactive, kbAtInteractive: Math.round(bytesAtInteractive / 1024), kbTotal: Math.round(served / 1024), idleAt, requests });
  if (i === 0 && process.env.BENCH_VERBOSE) {
    console.table([...reqs.values()]);
    console.table([...perUrl].map(([url, b]) => ({ url, kb: +(b / 1024).toFixed(1) })).sort((a, b) => b.kb - a.kb).slice(0, 25));
  }
  perUrl.clear();
  await ctx.close();
}
await browser.close();
server.close();
console.log(`profile=${profileName} cpu=${net.cpu}x runs=${runs} (cold cache, ms / KB on the wire, kbTotal includes service-worker precache)`);
console.table(results);
const med = (k) => results.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log("median:", Object.fromEntries(Object.keys(results[0]).map((k) => [k, med(k)])));
