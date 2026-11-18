// Snapshot the first screen of a built web app into its index.html, so a slow
// link paints the EQ workspace once HTML and CSS arrive instead of after every
// script. The snapshot is inert; src/main.tsx removes it before rendering.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// Mirrors MOBILE_QUERY in src/lib/tabs.ts, which picks the live layout.
const MOBILE_QUERY =
  "(max-width: 850px), ((max-height: 540px) and (pointer: coarse))";
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 412, height: 915 },
};
const READY_TEXT = "No bands yet. The EQ is flat.";
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

// Only the visible layout shows. public/boot-theme.js adds .no-prerender when
// the snapshot would be wrong (another language or route) or pointless (a
// service worker already serves the app in a blink); the logo shows instead.
const STYLE = `<style>#prerender,#prerender>div{display:contents}#prerender>.prerender-mobile{display:none}@media ${MOBILE_QUERY}{#prerender>.prerender-desktop{display:none}#prerender>.prerender-mobile{display:contents}}html:not(.no-prerender) #prerender~#boot-shell,html.no-prerender #prerender{display:none}</style>`;

function serve(outDir, base) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith(base)) return res.writeHead(404).end();
    const rel = normalize(`/${path.slice(base.length)}`).slice(1) || "index.html";
    try {
      const body = await readFile(join(outDir, rel));
      res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Runs in the page. innerHTML drops live state that is not an attribute:
// form values and canvas pixels. Write them back before serializing.
function freeze() {
  const root = document.getElementById("root");
  for (const input of root.querySelectorAll("input")) {
    input.setAttribute("value", input.value);
    if (input.checked) input.setAttribute("checked", "");
  }
  for (const canvas of root.querySelectorAll("canvas")) {
    const image = document.createElement("img");
    for (const { name, value } of canvas.attributes) image.setAttribute(name, value);
    image.setAttribute("alt", "");
    image.src = canvas.toDataURL("image/webp", 0.8);
    image.style.width = `${canvas.clientWidth}px`;
    image.style.height = `${canvas.clientHeight}px`;
    canvas.replaceWith(image);
  }
  return root.innerHTML;
}

async function snapshot(url) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    throw new Error(`prerender: @playwright/test is required (${error.message})`);
  }
  const browser = await chromium.launch().catch((error) => {
    throw new Error(
      `prerender: cannot start Chromium. Run "npx playwright install chromium". ${error.message}`,
    );
  });
  try {
    const shots = {};
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport, locale: "en-US", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.getByText(READY_TEXT).waitFor({ timeout: 30000 });
      if (errors.length) throw new Error(`prerender: page errors at ${name}: ${errors.join("; ")}`);
      shots[name] = await page.evaluate(freeze);
      await context.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}

/** Rewrite outDir/index.html in place with desktop and mobile snapshots. */
export async function prerender(outDir, base) {
  const root = base.startsWith("/") ? base : "/";
  const server = await serve(outDir, root);
  try {
    const shots = await snapshot(`http://127.0.0.1:${server.address().port}${root}`);
    const indexPath = join(outDir, "index.html");
    const html = await readFile(indexPath, "utf8");
    const marker = '<div id="root">';
    if (!html.includes(marker)) throw new Error("prerender: #root not found in index.html");
    const snapshotHtml =
      '<div id="prerender" inert aria-hidden="true">' +
      `<div class="prerender-desktop">${shots.desktop}</div>` +
      `<div class="prerender-mobile">${shots.mobile}</div></div>`;
    await writeFile(
      indexPath,
      // Function replacements: snapshot text may contain "$&"-style patterns.
      html.replace("</head>", () => `${STYLE}</head>`).replace(marker, () => marker + snapshotHtml),
    );
  } finally {
    server.close();
  }
}
