/* 链接外部打开 —— 渲染进程侧（v1.4）
 *
 * 只留一个兜底：普通页面里 window.open 的 http(s) 请求转交系统默认浏览器。
 * 主路径（QQ 内置浏览器窗口的自动转发 + 关窗）已由主进程直接注入，见 main.js（不依赖 LLQQNT 是否把插件注入到 qqBrowser.html）。
 */
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

function openExternal(url, how) {
    try {
        if (window.openInBrowser && typeof window.openInBrowser.open === "function") {
            window.openInBrowser.open(url);
        } else if (window.LiteLoader && window.LiteLoader.api && window.LiteLoader.api.openExternal) {
            window.LiteLoader.api.openExternal(url);
        } else {
            return;
        }
        console.error("[open-in-browser] 已交给默认浏览器(" + how + "): " + String(url).slice(0, 160));
    } catch (e) {
        console.error("[open-in-browser] 外开失败: " + (e && e.message));
    }
}

const origOpen = window.open;
window.open = function (url, ...rest) {
    if (isHttp(url)) {
        openExternal(url, "window.open");
        return null;
    }
    return origOpen.apply(this, [url, ...rest]);
};
