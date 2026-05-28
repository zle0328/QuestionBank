import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const targetUrl = process.argv[2] || "http://127.0.0.1:5173/";
const screenshotsDir = path.resolve("screenshots");
const desktopScreenshot = path.join(screenshotsDir, "desktop.png");
const mobileScreenshot = path.join(screenshotsDir, "mobile.png");
const mobileDetailScreenshot = path.join(screenshotsDir, "mobile-detail.png");
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
      const details = result.exceptionDetails;
      const stack = details.stackTrace?.callFrames
        ?.map((frame) => `${frame.functionName || "<anonymous>"} (${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`)
        .join("\n");
      throw new Error(
        [
          details.text || "Runtime evaluation failed",
          details.exception?.description,
          stack,
        ].filter(Boolean).join("\n"),
      );
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
    const desktopScrollCheck = await cdp.evaluate(`(() => {
      const detail = document.querySelector('.detail-panel');
      const list = document.querySelector('.list-panel');
      const filter = document.querySelector('.filter-panel');
      detail.scrollTop = 360;
      return {
        bodyScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight + 4,
        detailScrolled: detail.scrollTop > 0,
        listUnmoved: list.scrollTop === 0,
        filterUnmoved: filter.scrollTop === 0
      };
    })()`);
    if (
      desktopScrollCheck.bodyScrollable ||
      !desktopScrollCheck.detailScrolled ||
      !desktopScrollCheck.listUnmoved ||
      !desktopScrollCheck.filterUnmoved
    ) {
      throw new Error(`Desktop fixed-column scroll check failed: ${JSON.stringify(desktopScrollCheck)}`);
    }

    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search-box input');
      input.value = 'Java';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor("document.querySelector('.list-panel')?.innerText.includes('Java')");
    await cdp.waitFor("document.querySelector('.item-row mark') !== null");
    const searchHighlightCheck = await cdp.evaluate(`(() => ({
      hasMark: !!document.querySelector('.item-row mark'),
      firstRowText: document.querySelector('.item-row')?.innerText ?? ''
    }))()`);
    if (!searchHighlightCheck.hasMark || !searchHighlightCheck.firstRowText.includes("Java")) {
      throw new Error(`Search highlight check failed: ${JSON.stringify(searchHighlightCheck)}`);
    }

    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search-box input');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor("document.querySelectorAll('.item-row').length > 1");
    await cdp.evaluate("document.querySelector('.item-row')?.click(); true");
    await cdp.waitFor("document.querySelector('.study-progress')?.innerText.includes('第 1')");
    await cdp.evaluate(`
      [...document.querySelectorAll('.study-controls button')]
        .find((button) => button.textContent.includes('下一题'))
        ?.click();
      true;
    `);
    await cdp.waitFor("document.querySelector('.study-progress')?.innerText.includes('第 2')");
    const studyNavigationCheck = await cdp.evaluate(`(() => ({
      progress: document.querySelector('.study-progress')?.innerText ?? '',
      activeTitle: document.querySelector('.detail-content h1')?.innerText ?? ''
    }))()`);
    if (!studyNavigationCheck.progress.includes("第 2")) {
      throw new Error(`Study navigation check failed: ${JSON.stringify(studyNavigationCheck)}`);
    }

    await cdp.evaluate(`
      [...document.querySelectorAll('.study-controls .text-button')]
        .find((button) => button.textContent.includes('加入复习'))
        ?.click();
      true;
    `);
    await cdp.waitFor(
      "[...document.querySelectorAll('.mode-tabs button')].some((button) => button.textContent.includes('待复习')) && document.querySelector('.stats-strip')?.innerText.includes('待复习 1')",
    );
    await cdp.evaluate(`
      [...document.querySelectorAll('.mode-tabs button')]
        .find((button) => button.textContent.includes('待复习'))
        ?.click();
      true;
    `);
    await cdp.waitFor(
      "document.querySelector('.list-panel .panel-heading')?.innerText.includes('待复习题目') && document.querySelectorAll('.item-row').length === 1",
    );
    const reviewModeCheck = await cdp.evaluate(`(() => ({
      title: document.querySelector('.list-panel .panel-heading')?.innerText ?? '',
      rowCount: document.querySelectorAll('.item-row').length,
      stats: document.querySelector('.stats-strip')?.innerText ?? ''
    }))()`);
    if (!reviewModeCheck.title.includes("待复习题目") || reviewModeCheck.rowCount !== 1) {
      throw new Error(`Review mode check failed: ${JSON.stringify(reviewModeCheck)}`);
    }

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
    await cdp.evaluate("document.querySelector('.filter-panel .mobile-only')?.click(); true");
    await cdp.waitFor("document.querySelector('.filter-panel.open') === null");
    await cdp.evaluate("document.querySelector('.item-row')?.click(); true");
    await cdp.waitFor(
      "document.querySelector('.workspace.mobile-detail-open .detail-panel') !== null && getComputedStyle(document.querySelector('.detail-panel')).display !== 'none'",
    );
    const mobileDetailCheck = await cdp.evaluate(`(() => ({
      hasBackButton: !!document.querySelector('.mobile-detail-bar button'),
      listHidden: getComputedStyle(document.querySelector('.list-panel')).display === 'none',
      detailVisible: getComputedStyle(document.querySelector('.detail-panel')).display !== 'none'
    }))()`);
    if (!mobileDetailCheck.hasBackButton || !mobileDetailCheck.listHidden || !mobileDetailCheck.detailVisible) {
      throw new Error(`Mobile detail check failed: ${JSON.stringify(mobileDetailCheck)}`);
    }
    await cdp.screenshot(mobileDetailScreenshot);

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
          mobileDetailScreenshot,
          desktopScrollCheck,
          searchHighlightCheck,
          studyNavigationCheck,
          reviewModeCheck,
          mobileDrawer,
          mobileDetailCheck,
          checks: [
            "loaded question rows",
            "captured desktop screenshot",
            "expanded answer",
            "desktop detail scroll keeps left columns fixed",
            "searched Java with highlight",
            "navigated to the next question",
            "added question to review mode",
            "opened knowledge view",
            "opened mobile filter drawer",
            "opened mobile detail view from list",
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
