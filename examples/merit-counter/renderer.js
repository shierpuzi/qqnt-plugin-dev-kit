/* 功德计数器 v2 —— 电子木鱼版
 * 左侧栏按钮：木鱼图标 + 点击音效 + 常驻总次数徽标 + 长按清零
 *
 * 实测依据（QQ NT 9.9.33-52230）：
 *  - 注入容器 .sidebar__nav（nav sidebar__nav vue-component，flex/column/center，约 52px 宽）
 *  - 子项 .nav-item[size="22"][scene="nav"][role="button"]，36x36；隐藏项 0x0
 *  - 克隆 .nav-item 可继承 QQ 样式；cloneNode 不复制事件监听器 → 克隆体只属于本插件
 *  - localStorage 在 app:// 页面跨 QQ 重启保留（实测）
 *  - 音效不用音频文件：Web Audio 现场合成（真实点击是用户手势，允许启动 AudioContext）
 * 不修改 QQ 任何已有元素，不绕过任何校验。
 */
(() => {
  const V = "v2";
  if (window.__meritCounterV2) return "already";
  if (location.hash.indexOf("/main") < 0) return "not-main";
  window.__meritCounterV2 = true;

  const KEY = "merit-counter:count";
  let n = parseInt(localStorage.getItem(KEY) || "0", 10) || 0;
  let audioCtx = null;
  let holdTimer = null;
  let lastLongPress = 0;

  const CSS = [
    ".merit-btn{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;",
    "transition:transform .12s ease,opacity .12s ease}",
    ".merit-btn.merit-hold{transform:scale(.9);opacity:.65}",
    ".merit-btn .merit-ico{width:22px;height:22px;display:block;color:inherit}",
    ".merit-badge{position:absolute;top:1px;right:0;min-width:13px;height:13px;padding:0 3px;",
    "border-radius:999px;background:#ff5a5f;color:#fff;font:600 9px/13px system-ui,'Microsoft YaHei',sans-serif;",
    "text-align:center;box-shadow:0 0 0 1px rgba(255,255,255,.35);pointer-events:none}",
    ".merit-pop{position:fixed;z-index:2147483000;pointer-events:none;opacity:1;",
    "font:12px/1.35 system-ui,'Microsoft YaHei',sans-serif;color:#fff;background:rgba(0,0,0,.74);",
    "border-radius:8px;padding:6px 9px;white-space:nowrap;transition:transform .9s ease-out,opacity .9s ease-out}",
    ".merit-pop b{font-size:15px;color:#ffd76a}"
  ].join("");

  const ICON = [
    '<svg class="merit-ico" viewBox="0 0 24 24" aria-hidden="true">',
    '<ellipse cx="12" cy="14.2" rx="9" ry="6.4" fill="currentColor"/>',
    '<path d="M6.2 13.4h11.6" stroke="rgba(0,0,0,.55)" stroke-width="1.7" stroke-linecap="round"/>',
    '<circle cx="8.7" cy="12.2" r="1.05" fill="rgba(0,0,0,.5)"/>',
    '<path d="M9.2 7.6c1.3-2.1 4.3-2.1 5.6 0" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
    "</svg>"
  ].join("");

  function fmt(v) { return v < 1000 ? String(v) : (v / 1000).toFixed(1).replace(/\.0$/, "") + "k"; }

  /* 木鱼音效：三角波下滑 + 带通噪声瞬态，无需音频文件 */
  function knock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t0 = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1150, t0);
      osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.19);

      const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.03));
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 1.1;
      const ng = audioCtx.createGain(); ng.gain.value = 0.22;
      src.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
      src.start(t0);
    } catch (e) {
      console.error("[merit-counter] 音效失败: " + (e && e.message));
    }
  }

  function pop(btn, main, sub) {
    const r = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "merit-pop";
    el.innerHTML = "<b>" + main + "</b>" + (sub ? "　" + sub : "");
    el.style.left = (r.right + 8) + "px";
    el.style.top = (r.top + r.height / 2 - 14) + "px";
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = "translate(6px,-26px)"; el.style.opacity = "0"; });
    setTimeout(() => el.remove(), 950);
  }

  function install() {
    const nav = document.querySelector(".sidebar__nav");
    if (!nav) return false;
    const old = document.querySelector(".merit-btn");
    if (old && old.dataset.ver !== V) old.remove();          // 热替换旧版原型
    if (nav.querySelector('.merit-btn[data-ver="' + V + '"]')) return true;

    if (!document.getElementById("merit-counter-style")) {
      const st = document.createElement("style");
      st.id = "merit-counter-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    const tpl = [...nav.querySelectorAll(".nav-item")].find(e => e.getBoundingClientRect().height > 0);
    const btn = tpl ? tpl.cloneNode(true) : document.createElement("div");
    if (!tpl) btn.className = "nav-item";
    btn.classList.remove("nav-item-more");
    btn.classList.add("merit-btn");
    btn.dataset.ver = V;
    btn.removeAttribute("aria-pressed");
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.setAttribute("aria-label", "功德 +1（长按清零）");
    btn.innerHTML = ICON + '<span class="merit-badge">' + fmt(n) + "</span>";

    const badge = btn.querySelector(".merit-badge");
    const sync = () => {
      badge.textContent = fmt(n);
      btn.title = "共点击了 " + n + " 次（长按清零）";
    };
    sync();

    btn.addEventListener("pointerdown", () => {
      btn.classList.add("merit-hold");
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        n = 0;
        try { localStorage.setItem(KEY, "0"); } catch (e) { }
        lastLongPress = Date.now();
        sync();
        pop(btn, "已清零", "0 次");
        console.error("[merit-counter] 长按清零");
      }, 700);
    }, true);
    const release = () => { clearTimeout(holdTimer); btn.classList.remove("merit-hold"); };
    btn.addEventListener("pointerup", release, true);
    btn.addEventListener("pointercancel", release, true);
    btn.addEventListener("pointerleave", release, true);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Date.now() - lastLongPress < 600) return;          // 长按后的这次 click 不算
      knock();
      n++;
      try { localStorage.setItem(KEY, String(n)); } catch (err) { }
      sync();
      pop(btn, "+1", "共点击了 " + n + " 次");
      console.error("[merit-counter] 点击 " + n);
    }, true);

    nav.appendChild(btn);
    console.error("[merit-counter] v2 按钮已插入左侧栏（图标+音效+徽标+长按清零）");
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 500);
    setTimeout(() => clearInterval(timer), 60000);
  }
  return "installed";
})()
