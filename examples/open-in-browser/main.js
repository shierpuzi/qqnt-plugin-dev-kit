/* 链接外部打开 —— 主进程侧（v2.0）
 *
 * 结论（实测得出）：
 *   QQ 打开"内置浏览器"和工具栏那个 Edge 图标（用默认浏览器打开）都是**原生外壳（QQNT.dll）**做的：
 *   包住 59 个已注册的 invoke 处理器 + 15 个 on 通道后，点链接/点 Edge 图标一条都没被调用，
 *   shell.openExternal 也没被调用 —— 插件层拿不到它那个"方法"。所以只能在**导航发生的瞬间**拦。
 *
 * v2.0 做法（不再等页面加载）：
 *   非 webview 的 webContents 一旦要导航到 http(s)：
 *     openExternal(url)                → 立刻交给系统默认浏览器
 *     preventDefault / stop()          → 不让内置浏览器加载
 *     hide 那个内置浏览器窗口           → 别让它弹出来（可关：HIDE_INTERNAL_WINDOW）
 *   同一 URL 2 秒内只外开一次；不关窗口（关窗会让 QQ 重建并恢复标签，形成循环）。
 *
 * 另有兜底：window.open（setWindowOpenHandler）、老版 QQ 的 checkUrlsResult 载荷、渲染进程 IPC。
 */
const { shell, webContents, app, ipcMain, BrowserWindow } = require("electron");

const TAG = "[open-in-browser]";
const HIDE_INTERNAL_WINDOW = true;      // 拦到内置浏览器导航时顺手把它的窗口藏掉
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const DEDUPE_MS = 2000;

const recent = new Map();
function openExternal(url, why) {
    if (!isHttp(url)) return false;
    const now = Date.now();
    const last = recent.get(url);
    if (last && now - last < DEDUPE_MS) {
        console.error(`${TAG} 跳过重复外开(${why}): ${url.slice(0, 120)}`);
        return true;
    }
    recent.set(url, now);
    if (recent.size > 200) for (const [k, t] of recent) if (now - t > 15000) recent.delete(k);
    try {
        shell.openExternal(url);
        console.error(`${TAG} 外开(${why}): ${url.slice(0, 160)}`);
        return true;
    } catch (e) {
        console.error(`${TAG} shell.openExternal 失败: ${e && e.message}`);
        return false;
    }
}

/* ---------- 核心：拦掉"内置浏览器"的导航 ---------- */
function shouldIntercept(wc, url) {
    if (!isHttp(url)) return false;
    let t = "?";
    try { t = wc.getType(); } catch (e) { }
    if (t === "webview") return false;          // 小程序 / guild 面板的 webview 不动
    return true;
}

function hideOwner(wc) {
    if (!HIDE_INTERNAL_WINDOW) return;
    try {
        const w = BrowserWindow.fromWebContents(wc);
        if (w && w.isVisible()) {
            w.hide();
            console.error(`${TAG} 已藏起内置浏览器窗口 id=${w.id}`);
        }
    } catch (e) { }
}

function intercept(wc, url, why, ev) {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    openExternal(url, why);
    try { wc.stop(); } catch (e) { }
    hideOwner(wc);
}

function hookNavigation(wc) {
    // 1) 实例级 loadURL（外壳常常是直接 loadURL，不走 will-navigate）
    try {
        if (!wc.__oibLoadURL) {
            const orig = wc.loadURL.bind(wc);
            wc.loadURL = function (url, ...rest) {
                if (shouldIntercept(wc, url)) {
                    intercept(wc, url, "loadURL");
                    return Promise.resolve();
                }
                return orig(url, ...rest);
            };
            wc.__oibLoadURL = true;
        }
    } catch (e) { }

    // 2) 渲染进程发起的导航
    try {
        wc.on("will-navigate", (e, url) => { if (shouldIntercept(wc, url)) intercept(wc, url, "will-navigate", e); });
    } catch (e) { }
    try {
        wc.on("will-redirect", (e, url) => { if (shouldIntercept(wc, url)) intercept(wc, url, "will-redirect", e); });
    } catch (e) { }
    // 3) 兜底：已经开始导航了也拉回来
    try {
        wc.on("did-start-navigation", (e, url, inPlace, isMainFrame) => {
            if (isMainFrame && shouldIntercept(wc, url)) intercept(wc, url, "did-start-navigation");
        });
    } catch (e) { }
}

/* ---------- 辅助 ---------- */
function patchSend(wc) {
    if (!wc || wc.__openInBrowserPatched) return;
    wc.__openInBrowserPatched = true;
    const orig = wc.send.bind(wc);
    wc.send = function (channel, ...args) {
        try {
            for (const a of args) {
                const list = a && a.checkUrlsResult;
                if (!Array.isArray(list)) continue;
                for (const item of list) {
                    if (item && openExternal(item.url, "checkUrlsResult")) {
                        item.result = 1; item.jumpResult = 11; item.jumpUrl = "";
                    }
                }
            }
        } catch (e) { }
        return orig(channel, ...args);
    };
}

function guardWindowOpen(wc) {
    try {
        wc.setWindowOpenHandler(({ url }) => (openExternal(url, "window.open") ? { action: "deny" } : { action: "allow" }));
    } catch (e) { }
}

function hookWebContents(wc) {
    if (!wc) return;
    patchSend(wc);
    guardWindowOpen(wc);
    hookNavigation(wc);
    hookQQBrowser(wc);
}

/* ---------- 主路径：QQ 内置浏览器窗口里"立刻"转发到本地浏览器 ----------
 * 实测：QQ 开内置浏览器是原生外壳做的，Electron 的 IPC / 导航钩子全都碰不到，
 * 所以只能在它自己的浏览器窗口里，借它工具栏那个"用默认浏览器打开"按钮。
 * v2.1：标签一出现就点（不等页面加载完），并重试关闭标签，直到标签消失。
 */
const QQB_FORWARD_JS = String.raw`(function () {
  if (window.__qqbAutoForward) return "already";
  window.__qqbAutoForward = true;
  var acted = {}, startedAt = Date.now(), lastAct = 0;
  var LS = "open-in-browser:forwarded";
  function recentKey(k) {
    try { var o = JSON.parse(localStorage.getItem(LS) || "null"); return !!(o && o.key === k && (Date.now() - o.t) < 60000); } catch (e) { return false; }
  }
  function markKey(k) { try { localStorage.setItem(LS, JSON.stringify({ key: k, t: Date.now() })); } catch (e) { } }
  function tabEl() { return document.querySelector("#qqb-tabs .tab"); }
  function closeTabsSoon(n) {                                  // 把所有内置标签都关掉（QQ 有时一次点击开两个）
    var left = document.querySelectorAll("#qqb-tabs .tab .close-tab");
    if (left.length) { for (var i = 0; i < left.length; i++) { try { left[i].click(); } catch (e) { } } }
    if ((n || 0) < 20) setTimeout(function () { closeTabsSoon((n || 0) + 1); }, 250);
  }
  function forward() {
    if (Date.now() - startedAt < 15000) return;          // QQ 启动 15 秒内不动（那可能是它恢复的旧页面）
    if (Date.now() - lastAct < 3000) return;             // 3 秒冷却：一次点击最多转发一次
    var tab = tabEl();
    if (!tab) return;
    var id = tab.getAttribute("data-tab-id") || (tab.querySelector(".tab-content") && (tab.querySelector(".tab-content").textContent || "").trim());
    if (!id) return;
    if (acted[id] || recentKey(id)) return;
    var btn = document.getElementById("qqb-default-browser-button");
    if (!btn || btn.disabled) return;                    // 还没就绪就等下一轮（1 秒后重试）
    acted[id] = 1; markKey(id); lastAct = Date.now();
    console.error("[open-in-browser] 内置浏览器出现，转发到默认浏览器（并关掉它的所有标签）");
    btn.click();
    closeTabsSoon(0);
  }
  var obs = null;
  function attach() {
    var tabs = document.getElementById("qqb-tabs");
    if (tabs && !obs) { obs = new MutationObserver(forward); obs.observe(tabs, { childList: true, subtree: true, characterData: true }); }
    forward();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach); else attach();
  setInterval(attach, 1000);
  return "installed";
})()`;

const qqbHooked = new WeakSet();
function hookQQBrowser(wc) {
    if (!wc || qqbHooked.has(wc)) return;
    qqbHooked.add(wc);
    const inject = () => {
        let url = "";
        try { url = wc.getURL() || ""; } catch (e) { return; }
        if (!/qqBrowser\.html/i.test(url)) return;
        try {
            Promise.resolve(wc.executeJavaScript(QQB_FORWARD_JS, true))
                .then(r => { if (r !== "already") console.error(`${TAG} 已注入内置浏览器转发脚本`); })
                .catch(e => console.error(`${TAG} 注入失败: ${e && e.message}`));
        } catch (e) { }
    };
    try { wc.on("did-finish-load", inject); wc.on("did-navigate", inject); } catch (e) { }
    setTimeout(inject, 1200);
}

app.on("web-contents-created", (e, wc) => hookWebContents(wc));
try { webContents.getAllWebContents().forEach(hookWebContents); } catch (e) { }

exports.onBrowserWindowCreated = (win) => { try { hookWebContents(win.webContents); } catch (e) { } };
exports.onBrowserWindowCreating = () => { };

ipcMain.on("open-in-browser:open", (e, url) => openExternal(url, "renderer"));

console.error(`${TAG} 已加载 v2.1（内置浏览器一出现立刻转发，不等加载；导航钩子保留但实测碰不到）`);
