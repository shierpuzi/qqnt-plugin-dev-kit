/* 功德计数器 —— 在 QQ 左侧栏加一个按钮，点一下弹出 "+1 · 共点击了 N 次"
 * 选择器依据实测：.sidebar__nav（nav sidebar__nav vue-component，flex column center）内含 8 个 .nav-item（36x36）
 * 计数存 localStorage（跨重启保留）；不需要 main/preload。
 */
(() => {
  if (window.__meritCounterLoaded) return "already";
  if (location.hash.indexOf("/main") < 0) return "not-main";
  window.__meritCounterLoaded = true;

  const KEY = "merit-counter:count";
  let count = parseInt(localStorage.getItem(KEY) || "0", 10) || 0;

  const css = document.createElement("style");
  css.textContent = [
    ".merit-btn{display:flex;align-items:center;justify-content:center;cursor:pointer}",
    ".merit-btn .merit-glyph{font-size:13px;line-height:1;user-select:none}",
    ".merit-pop{position:fixed;z-index:2147483000;pointer-events:none;",
    "font:12px/1.35 system-ui,'Microsoft YaHei',sans-serif;color:#fff;background:rgba(0,0,0,.72);",
    "border-radius:8px;padding:6px 9px;white-space:nowrap;opacity:1;",
    "transition:transform .9s ease-out,opacity .9s ease-out}",
    ".merit-pop b{font-size:15px;color:#ffd76a}"
  ].join("");
  document.head.appendChild(css);

  function pop(btn) {
    const r = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "merit-pop";
    el.innerHTML = "<b>+1</b>　共点击了 " + count + " 次";
    el.style.left = (r.right + 8) + "px";
    el.style.top = (r.top + r.height / 2 - 14) + "px";
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.transform = "translate(6px,-26px)"; el.style.opacity = "0"; });
    setTimeout(function () { el.remove(); }, 950);
  }

  function install() {
    const nav = document.querySelector(".sidebar__nav");
    if (!nav) return false;
    if (nav.querySelector(".merit-btn")) return true;
    const tpl = [...nav.querySelectorAll(".nav-item")].find(function (e) { return e.getBoundingClientRect().height > 0; });
    let btn;
    if (tpl) {
      btn = tpl.cloneNode(true);
      btn.classList.remove("nav-item-more");
      btn.classList.add("merit-btn");
      btn.innerHTML = '<span class="merit-glyph">＋1</span>';
    } else {
      btn = document.createElement("div");
      btn.className = "nav-item merit-btn";
      btn.innerHTML = '<span class="merit-glyph">＋1</span>';
    }
    btn.setAttribute("aria-label", "功德 +1");
    btn.setAttribute("title", "共点击了 " + count + " 次");
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      count++;
      try { localStorage.setItem(KEY, String(count)); } catch (err) { }
      btn.setAttribute("title", "共点击了 " + count + " 次");
      pop(btn);
      console.error("[merit-counter] 点击 " + count);
    }, true);
    nav.appendChild(btn);
    console.error("[merit-counter] 按钮已插入左侧栏");
    return true;
  }

  if (!install()) {
    const timer = setInterval(function () { if (install()) clearInterval(timer); }, 500);
    setTimeout(function () { clearInterval(timer); }, 60000);
  }
  return "installed";
})()