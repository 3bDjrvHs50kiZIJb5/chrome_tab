import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const POLL_INTERVAL_MS = 1000;
const RELOAD_DEBOUNCE_MS = 500;
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const TARGET_EXTENSION_ID = process.env.EXTENSION_ID || "";

const IGNORED_DIRS = new Set([".git", "node_modules", "scripts/.cache"]);
const IGNORED_FILES = new Set(["package-lock.json"]);
const watchedExts = new Set([".js", ".mjs", ".json", ".html", ".css"]);

const fileMtimeMap = new Map();
let scheduledReloadTimer = null;
let isReloading = false;

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(relativePath) || IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (IGNORED_FILES.has(entry.name)) {
      continue;
    }

    if (!watchedExts.has(path.extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function buildSnapshot() {
  const files = await walkFiles(ROOT);
  const snapshot = new Map();

  for (const file of files) {
    const fileStat = await stat(file);
    snapshot.set(file, fileStat.mtimeMs);
  }

  return snapshot;
}

function diffChanges(oldMap, newMap) {
  const changed = [];

  for (const [file, mtime] of newMap.entries()) {
    if (!oldMap.has(file) || oldMap.get(file) !== mtime) {
      changed.push(file);
    }
  }

  for (const file of oldMap.keys()) {
    if (!newMap.has(file)) {
      changed.push(file);
    }
  }

  return changed;
}

async function getTargets() {
  const listUrl = `http://127.0.0.1:${DEBUG_PORT}/json/list`;
  const res = await fetch(listUrl);
  if (!res.ok) {
    throw new Error(`读取 CDP 目标失败: HTTP ${res.status}`);
  }
  return await res.json();
}

function pickExtensionTarget(targets) {
  const extensionTargets = targets.filter((t) => {
    return (
      (t.type === "service_worker" || t.type === "background_page") &&
      typeof t.url === "string" &&
      t.url.startsWith("chrome-extension://") &&
      t.webSocketDebuggerUrl
    );
  });

  if (TARGET_EXTENSION_ID) {
    const matched = extensionTargets.find((t) =>
      t.url.startsWith(`chrome-extension://${TARGET_EXTENSION_ID}/`)
    );
    if (matched) {
      return matched;
    }
  }

  return extensionTargets.find((t) => t.url.endsWith("/background.js")) || extensionTargets[0];
}

async function evalByCDP(webSocketUrl, expression) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    const reqId = Math.floor(Math.random() * 1000000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: reqId,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
          },
        })
      );
    });

    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.id !== reqId) {
        return;
      }
      ws.close();

      if (data.error) {
        reject(new Error(data.error.message || "CDP 执行失败"));
        return;
      }

      resolve(data.result);
    });

    ws.addEventListener("error", (event) => {
      reject(new Error(`WebSocket 错误: ${event.message || "未知错误"}`));
    });
  });
}

async function reloadExtension() {
  const targets = await getTargets();
  const target = pickExtensionTarget(targets);

  if (!target) {
    throw new Error(
      "未找到扩展调试目标。请先在 Chrome 中加载该扩展，并使用 --remote-debugging-port=9222 启动 Chrome。"
    );
  }

  await evalByCDP(target.webSocketDebuggerUrl, "chrome.runtime.reload()");
}

function scheduleReload(changedFiles) {
  if (scheduledReloadTimer) {
    clearTimeout(scheduledReloadTimer);
  }

  scheduledReloadTimer = setTimeout(async () => {
    if (isReloading) {
      return;
    }

    isReloading = true;
    const displayFiles = changedFiles.map((f) => path.relative(ROOT, f)).slice(0, 5);
    console.log(`\n检测到变更: ${displayFiles.join(", ")}${changedFiles.length > 5 ? "..." : ""}`);

    try {
      await reloadExtension();
      console.log("扩展已自动重新加载。");
    } catch (error) {
      console.error(`自动重载失败: ${error.message}`);
    } finally {
      isReloading = false;
    }
  }, RELOAD_DEBOUNCE_MS);
}

async function start() {
  console.log(`监听目录: ${ROOT}`);
  console.log(`Chrome 调试端口: ${DEBUG_PORT}`);
  if (TARGET_EXTENSION_ID) {
    console.log(`目标扩展 ID: ${TARGET_EXTENSION_ID}`);
  }
  console.log("开始监听文件变化...");

  const initial = await buildSnapshot();
  for (const [file, mtime] of initial.entries()) {
    fileMtimeMap.set(file, mtime);
  }

  setInterval(async () => {
    try {
      const nextSnapshot = await buildSnapshot();
      const changed = diffChanges(fileMtimeMap, nextSnapshot);

      fileMtimeMap.clear();
      for (const [file, mtime] of nextSnapshot.entries()) {
        fileMtimeMap.set(file, mtime);
      }

      if (changed.length > 0) {
        scheduleReload(changed);
      }
    } catch (error) {
      console.error(`监听出错: ${error.message}`);
    }
  }, POLL_INTERVAL_MS);
}

start().catch((error) => {
  console.error(`启动失败: ${error.message}`);
  process.exit(1);
});
