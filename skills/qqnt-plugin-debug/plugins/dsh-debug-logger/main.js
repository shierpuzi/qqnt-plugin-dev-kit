/* DSH 调试日志 v1.3
 * 1) 主进程 + 所有 webContents 的 console / preload 错误 / 未捕获异常
 *    <data>/dsh-debug-logger/console.log（跳过 VERBOSE 噪声）、errors.log（仅 warn/error）
 * 2) 迷你 devtools：把 JS 写进 eval.txt，结果出现在 eval-result.log
 * 3) 窗口追踪：谁创建/显示了窗口（带调用栈），用于抓"自己弹出来的窗口"
 * 4) 日志上限：任一文件超过 5 MB 就自动截断，只保留最近 2 MB（从整行边界开始）
 */
const fs = require("fs");
const path = require("path");
const { app, webContents, BrowserWindow } = require("electron");

const logDir = path.join(LiteLoader.path.data, "dsh-debug-logger");
fs.mkdirSync(logDir, { recursive: true });
const allFile = path.join(logDir, "console.log");
const errFile = path.join(logDir, "errors.log");
const evalFile = path.join(logDir, "eval.txt");
const evalOutFile = path.join(logDir, "eval-result.log");

const MAX_BYTES = 5 * 1024 * 1024;    // 单文件上限 5 MB
const KEEP_BYTES = 2 * 1024 * 1024;   // 超限后保留尾部 2 MB

function append(file, s) {
    try {
        fs.appendFileSync(file, s);
        if (fs.statSync(file).size > MAX_BYTES) truncateTail(file);
    } catch { }
}

function truncateTail(file) {
    const buf = fs.readFileSync(file);
    const tail = buf.subarray(Math.max(0, buf.length - KEEP_BYTES));
    const nl = tail.indexOf(0x0A);   // 从整行边界开始，避免保留半行
    fs.writeFileSync(file, Buffer.concat([
        Buffer.from(`[已截断，仅保留最近 ${Math.round(KEEP_BYTES / 1048576)} MB]\n`, "utf8"),
        nl >= 0 ? tail.subarray(nl + 1) : tail
    ]));
}

function write(tag, level, text) {
    const s = `[${new Date().toISOString()}] [${tag}] ${level} ${text}\n`;
    if (!/VERBOSE/i.test(level)) append(allFile, s);
    if (/ERROR|WARN|ASSERT|EXCEPTION/i.test(level)) append(errFile, s);
}

function str(v) {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || v.message;
    try { return JSON.stringify(v); } catch { return String(v); }
}

write("logger", "INFO", `loaded v1.3 (electron ${process.versions.electron}, qq ${LiteLoader.package?.qqnt?.version}, 日志上限 5MB/保留 2MB)`);

// ---- 主进程 console + 异常 ----
for (const lv of ["error", "warn"]) {
    const orig = console[lv].bind(console);
    console[lv] = (...a) => { write("main", lv.toUpperCase(), a.map(str).join(" ")); orig(...a); };
}
process.on("uncaughtException", e => write("main", "UNCAUGHT_EXCEPTION", str(e)));
process.on("unhandledRejection", r => write("main", "UNHANDLED_REJECTION", str(r)));

// ---- 窗口创建 / 显示追踪（抓"自己弹出来的窗口"）----
function callStack(skip, depth) {
    try { return new Error().stack.split("\n").slice(skip, skip + depth).map(s => s.trim().replace(/\s+/g, " ")).join(" <- "); }
    catch { return "?"; }
}

app.on("browser-window-created", (e, win) => {
    let url = "";
    try { url = win.webContents.getURL(); } catch { }
    write("window", "CREATED", `id=${win.id} url=${url || "(empty)"}  <- ${callStack(2, 8)}`);
    try {
        win.webContents.on("did-finish-load", () => write("window", "LOADED", `id=${win.id} url=${win.webContents.getURL()}`));
    } catch { }
});

try {
    for (const m of ["show", "showInactive", "focus", "restore", "moveTop"]) {
        if (typeof BrowserWindow.prototype[m] === "function") {
            const orig = BrowserWindow.prototype[m];
            BrowserWindow.prototype[m] = function (...a) {
                let u = ""; try { u = this.webContents.getURL(); } catch { }
                write("window", "SHOW/" + m, `id=${this.id} url=${u || "(empty)"}  <- ${callStack(2, 9)}`);
                return orig.apply(this, a);
            };
        }
    }
} catch (e) { write("window", "WARN", "patch BrowserWindow failed: " + e.message); }

// ---- 渲染进程 console ----
const LEVELS = { 0: "VERBOSE", 1: "INFO", 2: "WARN", 3: "ERROR" };
const attached = new WeakSet();

function attach(wc) {
    if (!wc || attached.has(wc)) return;
    attached.add(wc);
    const tag = () => {
        try { return "renderer:" + (wc.getTitle() || "") + ":" + (wc.getURL() || "").split("?")[0].slice(-40); }
        catch { return "renderer"; }
    };
    wc.on("console-message", (...args) => {
        const d = args[1];
        if (d && typeof d === "object" && ("message" in d)) {
            const lv = typeof d.level === "number" ? (LEVELS[d.level] || d.level) : String(d.level).toUpperCase();
            write(tag(), lv, `${d.message}  @${(d.sourceId || d.url || "?").slice(-70)}:${d.lineNumber ?? 0}`);
        } else {
            const [, level, message, line, sourceId] = args;
            write(tag(), LEVELS[level] || String(level), `${message}  @${sourceId}:${line}`);
        }
    });
    wc.on("preload-error", (e, preloadPath, err) => write(tag(), "PRELOAD_ERROR", `${preloadPath} ${str(err)}`));
    wc.on("render-process-gone", (e, details) => write(tag(), "RENDER_GONE", str(details)));
    wc.on("did-fail-load", (e, code, desc, url) => write(tag(), "LOAD_FAIL", `${code} ${desc} ${url}`));
}

app.on("web-contents-created", (e, wc) => {
    let t = "?"; try { t = wc.getType(); } catch { }
    write("window", "WEB_CONTENTS_CREATED", `type=${t} <- ${callStack(2, 8)}`);
    attach(wc);
});
try { webContents.getAllWebContents().forEach(attach); } catch { }
exports.onBrowserWindowCreated = (win) => { try { attach(win.webContents); } catch { } };
exports.onBrowserWindowCreating = () => { };

// ---- 渲染进程 → 主进程 IPC 频道记录（抓"谁要求开窗口/切会话"）----
try {
    const ipcMain = require("electron").ipcMain;
    const origEmit = ipcMain.emit.bind(ipcMain);
    const seen = new Map();
    const WANT = /chat|aio|window|show|open|session|switch|focus|activate|recent|contact/i;
    ipcMain.emit = function (channel, ...args) {
        try {
            if (typeof channel === "string" && WANT.test(channel)) {
                const ev = args[0];
                let url = "?";
                try { url = (ev && ev.sender && ev.sender.getURL ? ev.sender.getURL() : "").split("?")[0].slice(-45) || "?"; } catch { }
                const k = channel + "|" + url;
                const now = Date.now();
                if (!seen.has(k) || now - seen.get(k) > 1500) {
                    seen.set(k, now);
                    let extra = "";
                    try { extra = JSON.stringify(args.slice(1)).slice(0, 160); } catch { }
                    write("ipc", "IN", `${channel}  from=${url}  ${extra}`);
                }
            }
        } catch { }
        return origEmit(channel, ...args);
    };
} catch (e) { write("ipc", "WARN", "patch ipcMain failed: " + e.message); }

// ---- 迷你 devtools ----
// 注意：启动时把已存在的 eval.txt 记为"已执行过"，只有文件被重新写入后才执行。
// （否则每次重启都会重放上次留下的脚本 —— 曾因此把 QQ 窗口导航到测试网址导致卡死）
let lastKey = "";
try { if (fs.existsSync(evalFile)) lastKey = fs.readFileSync(evalFile, "utf8").trim(); } catch { }
setInterval(() => {
    try {
        if (!fs.existsSync(evalFile)) return;
        const code = fs.readFileSync(evalFile, "utf8");
        const key = code.trim();
        if (!key || key === lastKey) return;
        lastKey = key;
        append(evalOutFile, `\n===== ${new Date().toISOString()} =====\nCODE: ${key}\n`);
        webContents.getAllWebContents().forEach(async (wc) => {
            let name = "?";
            try { name = (wc.getURL() || "").split("?")[0].slice(-50); } catch { }
            try {
                const r = await wc.executeJavaScript(code, true);
                append(evalOutFile, `--- [${name}] => ${JSON.stringify(r)?.slice(0, 4000)}\n`);
            } catch (e) {
                append(evalOutFile, `--- [${name}] EXEC_FAIL ${e && e.message}\n`);
            }
        });
    } catch { }
}, 1000);
