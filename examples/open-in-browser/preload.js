/* 链接外部打开 —— preload 侧
 * 给渲染进程一个走主进程去重逻辑的通道（侦察用的 IPC spy 已撤掉）
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openInBrowser", {
    open: (url) => ipcRenderer.send("open-in-browser:open", url)
});
