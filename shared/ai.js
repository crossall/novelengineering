// 브라우저에서 Claude API를 직접 부르는 얇은 클라이언트.
// 키는 (1) shared/ai.local.js 의 window.NE_AI_KEY (gitignore, 강사 컴퓨터 전용)
//      (2) 이 브라우저의 localStorage  — 두 곳에서만 읽는다. 저장소에는 절대 넣지 않는다.
(function () {
  const NE = window.NE;
  const KEY_STORE = "ne.ai.key";
  const MODEL_STORE = "ne.ai.model";
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2023-06-01";
  const DEFAULT_MODEL = "claude-sonnet-5";
  const MODELS = [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5 (기본)", effort: true },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (빠르고 저렴)", effort: false },
    { id: "claude-opus-5", name: "Claude Opus 5 (가장 깊음)", effort: true }
  ];
  const DEFAULT_MAX_TOKENS = 4000;
  const PING_MAX_TOKENS = 20;

  function AiError(code, message) { this.code = code; this.message = message; }
  AiError.prototype = Object.create(Error.prototype);

  function localKey() { return typeof window.NE_AI_KEY === "string" ? window.NE_AI_KEY.trim() : ""; }
  function storedKey() { const k = NE.load(KEY_STORE, ""); return typeof k === "string" ? k.trim() : ""; }
  function getKey() { return localKey() || storedKey(); }
  function keySource() { return localKey() ? "local" : storedKey() ? "browser" : "none"; }
  function hasKey() { return getKey() !== ""; }
  function getModel() {
    const m = NE.load(MODEL_STORE, DEFAULT_MODEL);
    return MODELS.some(x => x.id === m) ? m : DEFAULT_MODEL;
  }
  function modelInfo(id) { return MODELS.find(m => m.id === id) || MODELS[0]; }

  function statusMessage(status, body) {
    const detail = body && body.error && body.error.message ? " (" + body.error.message.slice(0, 120) + ")" : "";
    if (status === 401) return "AI 키가 맞지 않아요. 'AI 설정'에서 키를 다시 확인해 주세요.";
    if (status === 403) return "이 키로는 쓸 수 없는 요청이에요." + detail;
    if (status === 400) return "요청이 잘못됐어요." + detail;
    if (status === 429) return "요청이 너무 많아요. 잠시 뒤에 다시 눌러 주세요.";
    if (status === 529 || status >= 500) return "AI 서버가 바빠요. 잠시 뒤에 다시 눌러 주세요.";
    return "AI 요청이 실패했어요 (" + status + ")." + detail;
  }

  // 한 번 묻고 텍스트를 받는다. { system, messages | user, effort, maxTokens, model }
  async function ask(opts) {
    const key = getKey();
    if (!key) throw new AiError("no_key", "AI 키가 없어요. 오른쪽 위 'AI 설정'에서 키를 넣어 주세요.");
    const model = opts.model || getModel();
    const messages = opts.messages || [{ role: "user", content: String(opts.user || "") }];
    const body = { model, max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS, messages };
    if (opts.system) body.system = opts.system;
    if (opts.effort && modelInfo(model).effort) body.output_config = { effort: opts.effort };
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new AiError("network", "AI 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new AiError("http_" + res.status, statusMessage(res.status, data));
    if (!data || !Array.isArray(data.content)) throw new AiError("bad_response", "AI 응답을 읽을 수 없어요.");
    if (data.stop_reason === "refusal") throw new AiError("refusal", "AI가 이 요청에는 답하지 않았어요. 질문을 바꿔 보세요.");
    const text = data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    return { text, model: data.model, stop: data.stop_reason, usage: data.usage || {} };
  }

  // 코드 울타리를 벗기고 첫 JSON 값을 파싱한다.
  function parseJson(text) {
    const stripped = String(text || "").replace(/```(?:json)?/gi, "").trim();
    const start = Math.min(...["{", "["].map(c => { const i = stripped.indexOf(c); return i < 0 ? Infinity : i; }));
    if (!isFinite(start)) throw new AiError("parse", "AI 답에서 JSON을 찾지 못했어요.");
    const open = stripped[start], close = open === "{" ? "}" : "]";
    const end = stripped.lastIndexOf(close);
    try { return JSON.parse(stripped.slice(start, end + 1)); }
    catch (e) { throw new AiError("parse", "AI 답의 JSON이 깨졌어요. 다시 눌러 보세요."); }
  }

  // 코드 울타리 안의 HTML, 없으면 <!DOCTYPE/<html 부터 </html> 까지를 뽑는다.
  function extractHtml(text) {
    const t = String(text || "");
    const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
    if (fence && /<html|<body|<script/i.test(fence[1])) return fence[1].trim();
    const start = t.search(/<!doctype html|<html/i);
    const end = t.lastIndexOf("</html>");
    if (start >= 0 && end > start) return t.slice(start, end + "</html>".length).trim();
    return "";
  }

  // 원문 43문장을 번호와 함께 한 덩어리로 (프롬프트용)
  function storyText() {
    return window.STORY.sentences.map(s => s.id + ". " + s.text).join("\n");
  }
  function constraintsText() {
    return window.STORY.constraints.map(c => "- [" + c.kind + "] " + c.text + " (근거 문장 " + c.evidence.join(", ") + ")").join("\n");
  }
  // "(문장 12)" / "문장 12, 14" 에서 유효한 문장 번호만 뽑는다
  function citedIds(text) {
    const max = window.STORY.sentences.length;
    const found = [];
    const re = /문장\s*(\d+(?:\s*[,，]\s*\d+)*)/g;
    let m;
    while ((m = re.exec(String(text || "")))) {
      m[1].split(/[,，]/).map(x => Number(x.trim())).forEach(n => { if (n >= 1 && n <= max && !found.includes(n)) found.push(n); });
    }
    return found;
  }

  // ---------- 설정 창 ----------
  function openSettings() {
    const el = NE.el;
    const old = document.getElementById("ne-ai-dialog");
    if (old) old.remove();
    const source = keySource();
    const keyInput = el("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off" });
    keyInput.value = storedKey();
    const showBtn = el("button", { type: "button", class: "ghost", text: "보기", onclick: () => { keyInput.type = keyInput.type === "password" ? "text" : "password"; } });
    const modelSel = el("select", {}, MODELS.map(m => el("option", { value: m.id, text: m.name })));
    modelSel.value = getModel();
    const status = el("div", { class: "hint", style: "min-height:1.4em;font-size:.88rem;margin-top:8px" });
    const sourceLine = source === "local"
      ? "이 컴퓨터의 shared/ai.local.js 에서 키를 읽고 있어요. 아래 칸은 비워 두어도 돼요."
      : source === "browser" ? "이 브라우저에 저장된 키를 쓰고 있어요." : "아직 키가 없어요.";
    const note = el("p", { class: "muted", style: "font-size:.82rem;margin:8px 0 0", text: "키는 이 브라우저에만 저장되고 서버로 보내지 않아요. 다만 브라우저에서 AI로 직접 요청하므로 공용 컴퓨터에서는 쓰고 나서 '키 지우기'를 눌러 주세요." });
    const setStatus = (msg, ok) => { status.textContent = msg; status.style.color = ok ? "var(--ok)" : "var(--bad)"; };
    const saveBtn = el("button", { type: "button", text: "저장", onclick: () => {
      const k = keyInput.value.trim();
      if (k && !/^sk-ant-/.test(k)) { setStatus("키는 보통 sk-ant- 로 시작해요. 다시 확인해 주세요.", false); return; }
      NE.save(KEY_STORE, k); NE.save(MODEL_STORE, modelSel.value);
      setStatus("저장했어요.", true); refreshBadge();
    } });
    const pingBtn = el("button", { type: "button", class: "secondary", text: "연결 확인", onclick: async () => {
      const k = keyInput.value.trim() || localKey();
      if (!k) { setStatus("먼저 키를 넣어 주세요.", false); return; }
      setStatus("확인하는 중…", true);
      try {
        const saved = storedKey();
        if (keyInput.value.trim()) NE.save(KEY_STORE, keyInput.value.trim());
        const r = await ask({ user: "안녕이라고 한 단어만 답해 주세요.", maxTokens: PING_MAX_TOKENS, model: modelSel.value });
        if (!keyInput.value.trim()) NE.save(KEY_STORE, saved);
        setStatus("연결됐어요. 모델: " + r.model, true); refreshBadge();
      } catch (e) { setStatus(e.message, false); }
    } });
    const clearBtn = el("button", { type: "button", class: "ghost", text: "키 지우기", onclick: () => { NE.save(KEY_STORE, ""); keyInput.value = ""; setStatus("이 브라우저의 키를 지웠어요.", true); refreshBadge(); } });
    const closeBtn = el("button", { type: "button", class: "ghost", text: "닫기", onclick: () => dialog.remove() });
    const dialog = el("div", { id: "ne-ai-dialog", style: "position:fixed;inset:0;background:rgba(43,38,32,.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px" }, [
      el("div", { class: "card", style: "max-width:520px;width:100%" }, [
        el("h3", { text: "AI 설정" }),
        el("p", { class: "muted", style: "font-size:.9rem", text: sourceLine }),
        el("label", { text: "Anthropic API 키" }),
        el("div", { class: "row" }, [keyInput, showBtn]),
        el("label", { text: "모델", style: "margin-top:10px" }), modelSel,
        status,
        el("div", { class: "row", style: "margin-top:10px" }, [saveBtn, pingBtn, clearBtn, closeBtn]),
        note
      ])
    ]);
    dialog.addEventListener("click", e => { if (e.target === dialog) dialog.remove(); });
    document.body.appendChild(dialog);
    keyInput.style.flex = "1";
  }

  function refreshBadge() {
    const b = document.getElementById("ne-ai-btn");
    if (!b) return;
    const on = hasKey();
    b.textContent = (on ? "● " : "○ ") + "AI 설정";
    b.style.color = on ? "var(--ok)" : "var(--muted)";
    b.title = on ? "AI 연결됨 · " + modelInfo(getModel()).name : "AI 키가 없어요";
  }

  function mountButton() {
    const host = document.querySelector(".ne-header") || document.getElementById("ai-settings-slot");
    if (!host || document.getElementById("ne-ai-btn")) return;
    const btn = NE.el("button", { id: "ne-ai-btn", type: "button", class: "ghost", style: "margin-left:auto;font-size:.82rem;padding:3px 10px", onclick: openSettings });
    host.appendChild(btn);
    refreshBadge();
  }

  window.NE.ai = { ask, parseJson, extractHtml, storyText, constraintsText, citedIds, hasKey, getKey, getModel, keySource, openSettings, MODELS, AiError };
  document.addEventListener("DOMContentLoaded", mountButton);
})();
