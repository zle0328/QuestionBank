import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const targetUrl = process.argv[2] || "http://127.0.0.1:5173/";
const screenshotsDir = path.resolve("screenshots");
const desktopScreenshot = path.join(screenshotsDir, "desktop.png");
const mobileScreenshot = path.join(screenshotsDir, "mobile.png");
const remotePort = 9333;
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

function findEdge() {
  const edgePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!edgePath) {
    throw new Error("Microsoft Edge executable was not found. Set EDGE_PATH to run UI smoke.");
  }
  return edgePath;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJson(url, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Keep polling while the browser starts.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectToPage(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const browserErrors = [];
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result ?? {});
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(message.params.exceptionDetails.text);
    }

    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      browserErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
      );
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function send(method, params = {}) {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }

    return result.result?.value;
  }

  async function waitFor(expression, timeoutMs = 12_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await delay(120);
    }
    throw new Error(`Timed out waiting for expression: ${expression}`);
  }

  async function screenshot(filePath) {
    const result = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await fsp.writeFile(filePath, Buffer.from(result.data, "base64"));
  }

  return { send, evaluate, waitFor, screenshot, browserErrors, close: () => socket.close() };
}

async function main() {
  await fsp.mkdir(screenshotsDir, { recursive: true });
  const edgePath = findEdge();
  const userDataDir = path.join(os.tmpdir(), `question-bank-edge-${Date.now()}`);
  const edge = spawn(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${remotePort}`,
      `--user-data-dir=${userDataDir}`,
      targetUrl,
    ],
    { stdio: "ignore" },
  );

  try {
    const pages = await pollJson(`http://127.0.0.1:${remotePort}/json/list`);
    const page = pages.find((item) => item.type === "page" && item.url.includes("127.0.0.1")) ?? pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error("Could not locate a debuggable page.");

    const cdp = await connectToPage(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await cdp.waitFor(
      "document.readyState === 'complete' && document.querySelectorAll('.item-row').length > 0",
    );
    const firstTitle = await cdp.evaluate("document.querySelector('.item-row h2')?.textContent?.trim()");
    await cdp.screenshot(desktopScreenshot);

    await cdp.evaluate("document.querySelector('.item-row')?.click(); true");
    await cdp.evaluate("document.querySelector('.primary-button')?.click(); true");
    await cdp.waitFor("document.querySelectorAll('.answer-section').length > 0");

    await cdp.evaluate(`
      const input = document.querySelector('.search-box input');
      input.value = 'Java';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      true;
    `);
    await cdp.waitFor("document.querySelector('.list-panel')?.innerText.includes('Java')");

    await cdp.evaluate(`
      [...document.querySelectorAll('.mode-tabs button')]
        .find((button) => button.textContent.includes('知识库'))
        ?.click();
      true;
    `);
    await cdp.waitFor(
      "document.querySelector('.list-panel .panel-heading')?.innerText.includes('知识文章') && document.querySelectorAll('.item-row').length > 0",
    );

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await cdp.waitFor(
      "document.readyState === 'complete' && document.querySelectorAll('.item-row').length > 0",
    );
    await cdp.evaluate(`
      window.scrollTo(0, 0);
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      true;
    `);
    await cdp.evaluate("document.querySelector('.topbar .mobile-only')?.click(); true");
    await cdp.waitFor("document.querySelector('.filter-panel.open') !== null");
    await cdp.waitFor(
      "Math.round(document.querySelector('.filter-panel.open')?.getBoundingClientRect().left ?? -999) >= -1",
      2_000,
    );
    const mobileDrawer = await cdp.evaluate(`(() => {
      const rect = document.querySelector('.filter-panel.open')?.getBoundingClientRect();
      return rect ? {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        scrollX: Math.round(window.scrollX || document.documentElement.scrollLeft || 0),
        viewport: window.innerWidth
      } : null;
    })()`);
    await cdp.screenshot(mobileScreenshot);

    if (cdp.browserErrors.length > 0) {
      throw new Error(`Browser console errors: ${cdp.browserErrors.join(" | ")}`);
    }

    cdp.close();
    console.log(
      JSON.stringify(
        {
          url: targetUrl,
          firstTitle,
          desktopScreenshot,
          mobileScreenshot,
          mobileDrawer,
          checks: [
            "loaded question rows",
            "captured desktop screenshot",
            "expanded answer",
            "searched Java",
            "opened knowledge view",
            "opened mobile filter drawer",
            "no console errors",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    edge.kill();
    await Promise.race([
      new Promise((resolve) => edge.once("exit", resolve)),
      delay(1200),
    ]);
    try {
      await fsp.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // Edge can keep dictionary files locked for a moment on Windows; they are safe temp files.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
