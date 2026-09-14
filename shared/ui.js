// 공통 UI 헬퍼. 각 페이지는 <body data-stage="2단계 문제 인식" data-who="교사" data-title="..."> 로 메타를 준다.
(function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(c => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function renderHeader() {
    const b = document.body;
    const depth = (location.pathname.match(/\//g) || []).length;
    const home = b.dataset.home || "../index.html";
    const header = el("header", { class: "ne-header" }, [
      el("a", { class: "ne-home", href: home, text: "← 노벨 엔지니어링 × 바이브코딩" }),
      b.dataset.stage ? el("span", { class: "ne-stage", text: b.dataset.stage }) : "",
      b.dataset.who ? el("span", { class: "ne-who", text: b.dataset.who + "가 만드는 것" }) : "",
      el("span", { class: "ne-title", text: b.dataset.title || document.title })
    ].filter(Boolean));
    b.insertBefore(header, b.firstChild);
    const footer = el("footer", { class: "ne-footer", text: "아기돼지 삼형제 · 노벨 엔지니어링 × 바이브코딩 예시 · 모든 데이터는 이 브라우저에만 저장됩니다" });
    b.appendChild(footer);
  }

  // 문장 번호 배지. 클릭하면 원문을 팝오버로 보여준다.
  function evidenceBadge(id) {
    const s = window.STORY && window.STORY.byId(id);
    const badge = el("span", { class: "evidence", text: "문장 " + id, title: s ? s.text : "" });
    badge.addEventListener("click", () => showQuote(id));
    return badge;
  }

  function showQuote(id) {
    const s = window.STORY.byId(id);
    if (!s) return;
    let box = document.getElementById("ne-quote-box");
    if (!box) {
      box = el("div", { id: "ne-quote-box", style: "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:640px;width:calc(100% - 32px);background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.15);padding:12px 16px;z-index:999;" });
      document.body.appendChild(box);
    }
    box.innerHTML = "";
    box.appendChild(el("div", { class: "quote" }, [
      el("span", { class: "n", text: "문장 " + s.id + " · " + window.STORY.sceneName(s.scene) }),
      s.text
    ]));
    box.appendChild(el("button", { class: "ghost", text: "닫기", style: "margin-top:6px", onclick: () => box.remove() }));
  }

  // localStorage 안전 래퍼
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function uid() { return Math.random().toString(36).slice(2, 9); }

  window.NE = { el, evidenceBadge, showQuote, load, save, uid };
  document.addEventListener("DOMContentLoaded", renderHeader);
})();
