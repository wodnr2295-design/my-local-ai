/**
 * 모아 — 내 기기 안의 AI
 * 화면 상태·저장(localStorage)·생성 흐름을 담당합니다.
 */

import {
  MODELS,
  DEFAULT_MODEL_ID,
  findModel,
  PERSONAS,
  findPersona,
  HISTORY_TURNS,
  MAX_OUTPUT_TOKENS,
} from "./config.js";
import { LocalEngine, detectWebGPU, describeGpu, humanizeProgress, phaseLabel, explainError, explainLoadError } from "./engine.js";

/* ── DOM ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $("sidebar"),
  sideClose: $("sideClose"),
  scrim: $("scrim"),
  menuBtn: $("menuBtn"),
  newChatBtn: $("newChatBtn"),
  chatList: $("chatList"),
  chatListEmpty: $("chatListEmpty"),
  personaList: $("personaList"),
  modelChip: $("modelChip"),
  modelChipName: $("modelChipName"),
  modelChipState: $("modelChipState"),
  modelDot: $("modelDot"),
  chatTitle: $("chatTitle"),
  chatSub: $("chatSub"),
  resetBtn: $("resetBtn"),

  gate: $("gate"),
  gateChecking: $("gateChecking"),
  gateUnsupported: $("gateUnsupported"),
  gateUnsupportedReason: $("gateUnsupportedReason"),
  gateSteps: $("gateSteps"),
  recheckBtn: $("recheckBtn"),
  gateReady: $("gateReady"),
  gpuText: $("gpuText"),
  modelGrid: $("modelGrid"),
  loadBtn: $("loadBtn"),
  loadBtnLabel: $("loadBtnLabel"),
  gateLoading: $("gateLoading"),
  progressPercent: $("progressPercent"),
  progressPhase: $("progressPhase"),
  progressFill: $("progressFill"),
  progressText: $("progressText"),
  gateError: $("gateError"),
  gateErrorText: $("gateErrorText"),
  gateErrorTips: $("gateErrorTips"),
  retryBtn: $("retryBtn"),
  errorBackBtn: $("errorBackBtn"),

  thread: $("thread"),
  messages: $("messages"),
  emptyState: $("emptyState"),
  emptyLead: $("emptyLead"),
  suggestions: $("suggestions"),
  jumpBtn: $("jumpBtn"),
  composerWrap: $("composerWrap"),
  composer: $("composer"),
  prompt: $("prompt"),
  sendBtn: $("sendBtn"),
  toast: $("toast"),

  modelDialog: $("modelDialog"),
  dialogModelGrid: $("dialogModelGrid"),
};

/* ── 저장 ───────────────────────────────────────────────────────────── */
const STORE_KEY = "moa.state.v1";
const engine = new LocalEngine();

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function emptyState() {
  return {
    version: 1,
    chats: [],
    activeId: null,
    persona: PERSONAS[0].id,
    modelId: DEFAULT_MODEL_ID,
    downloaded: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      ...emptyState(),
      ...parsed,
      chats: Array.isArray(parsed.chats) ? parsed.chats : [],
      downloaded: Array.isArray(parsed.downloaded) ? parsed.downloaded : [],
    };
  } catch (err) {
    console.warn("저장된 대화를 읽지 못했습니다.", err);
    return emptyState();
  }
}

let state = loadState();
let saveTimer = null;

function save(immediate = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("저장 실패", err);
      toast("저장 공간이 부족해 대화를 저장하지 못했어요");
    }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 220);
}

/* ── 작은 도구들 ────────────────────────────────────────────────────── */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
}

function renderMarkdown(source) {
  const parts = escapeHtml(source).split("```");
  let html = "";
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const body = part.replace(/^[a-zA-Z0-9+#.\-]*\n/, "").replace(/\n$/, "");
      html += `<pre class="code"><code>${body}</code></pre>`;
      return;
    }
    const blocks = part.split(/\n{2,}/);
    blocks.forEach((block) => {
      if (!block.trim()) return;
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        html += `<ul>${lines.map((l) => `<li>${inlineMarkdown(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
        return;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        html += `<ol>${lines.map((l) => `<li>${inlineMarkdown(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
        return;
      }
      if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) {
        html += `<h4>${inlineMarkdown(lines[0].replace(/^#{1,4}\s+/, ""))}</h4>`;
        return;
      }
      html += `<p>${inlineMarkdown(lines.join("\n")).replace(/\n/g, "<br>")}</p>`;
    });
  });
  return html;
}

function timeLabel(ts) {
  try {
    return new Date(ts).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => (els.toast.hidden = true), 220);
  }, 2400);
}

function icon(name, cls = "icon") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/* ── 대화 상태 ──────────────────────────────────────────────────────── */
function activeChat() {
  return state.chats.find((c) => c.id === state.activeId) || null;
}

function createChat() {
  const chat = {
    id: uid(),
    title: "새 대화",
    persona: state.persona,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.chats.unshift(chat);
  state.activeId = chat.id;
  if (state.chats.length > 30) state.chats = state.chats.slice(0, 30);
  save(true);
  return chat;
}

function ensureChat() {
  const current = activeChat();
  if (current) return current;
  return createChat();
}

function addMessage(chat, role, text, extra = {}) {
  const message = { id: uid(), role, text, ts: Date.now(), ...extra };
  chat.messages.push(message);
  // 아주 긴 대화가 저장 공간을 다 채우지 않도록 오래된 메시지는 덜어냄
  if (chat.messages.length > 300) chat.messages = chat.messages.slice(-240);
  chat.updatedAt = Date.now();
  return message;
}

function titleFrom(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 26 ? `${clean.slice(0, 26)}…` : clean || "새 대화";
}

function sortedChats() {
  return [...state.chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ── 사이드바 렌더 ──────────────────────────────────────────────────── */
function renderChatList() {
  const chats = sortedChats();
  els.chatList.innerHTML = chats
    .map((chat) => {
      const active = chat.id === state.activeId;
      return `<li>
        <div class="chat-item" data-active="${active}">
          <button class="chat-item-open" type="button" data-chat="${chat.id}" aria-current="${active}">
            <span class="chat-item-title">${escapeHtml(chat.title || "새 대화")}</span>
          </button>
          <button class="chat-item-del" type="button" data-del="${chat.id}" aria-label="대화 삭제" title="대화 삭제">
            ${icon("trash")}
          </button>
        </div>
      </li>`;
    })
    .join("");
  els.chatListEmpty.hidden = chats.length > 0;
  els.chatList.hidden = chats.length === 0;
}

function renderPersonas() {
  els.personaList.innerHTML = PERSONAS.map(
    (p) => `<button class="persona-btn" type="button" role="radio" aria-checked="${p.id === state.persona}" data-persona="${p.id}">
      <span class="persona-emoji" aria-hidden="true">${p.emoji}</span>
      <span>
        <span class="persona-name">${escapeHtml(p.name)}</span>
        <span class="persona-tag">${escapeHtml(p.tagline)}</span>
      </span>
    </button>`
  ).join("");
}

function updateTopbar() {
  const chat = activeChat();
  const persona = findPersona(chat?.persona || state.persona);
  els.chatTitle.textContent = chat?.title || "새 대화";
  if (engine.ready) {
    els.chatSub.textContent = `${persona.name} · ${findModel(engine.modelId || state.modelId).name} · 기기 내 실행`;
  } else {
    els.chatSub.textContent = "내 기기에서만 돌아가는 개인용 AI";
  }
  updateResetState();
}

function updateResetState() {
  const chat = activeChat();
  els.resetBtn.disabled = !chat || chat.messages.length === 0;
}

function updateModelChip(mode = "idle") {
  const model = findModel(state.modelId);
  els.modelChipName.textContent = model.name;
  els.modelDot.classList.remove("on", "busy");
  if (mode === "busy") {
    els.modelChipState.textContent = "준비 중…";
    els.modelDot.classList.add("busy");
  } else if (engine.ready) {
    els.modelChipState.textContent = "준비됨 · 여기서 변경";
    els.modelDot.classList.add("on");
  } else {
    els.modelChipState.textContent = state.downloaded.includes(state.modelId) ? "저장됨 · 대기" : "준비 전 · 여기서 변경";
  }
}

/* ── 게이트 ─────────────────────────────────────────────────────────── */
function showGate(view) {
  const views = {
    checking: els.gateChecking,
    unsupported: els.gateUnsupported,
    ready: els.gateReady,
    loading: els.gateLoading,
    error: els.gateError,
  };
  Object.entries(views).forEach(([key, node]) => {
    node.hidden = key !== view;
  });
  const chatting = view === "chat";
  els.gate.hidden = chatting;
  els.thread.hidden = !chatting;
  els.composerWrap.hidden = !chatting;
  if (!chatting) {
    els.gate.setAttribute("aria-busy", view === "checking" || view === "loading" ? "true" : "false");
  }
}

function renderModelCards() {
  const card = (model, inDialog) => {
    const checked = model.id === state.modelId;
    const downloaded = state.downloaded.includes(model.id);
    return `<button class="model-card" type="button" role="radio" aria-checked="${checked}" data-model="${model.id}" data-dialog="${inDialog}">
      <span class="model-check">${icon("check")}</span>
      <span class="model-card-top">
        <span class="model-name">${escapeHtml(model.name)}</span>
        <span class="model-badge">${escapeHtml(model.badge)}</span>
      </span>
      <span class="model-desc">${escapeHtml(model.desc)}</span>
      <span class="model-meta"><span>다운로드 <b>${escapeHtml(model.sizeLabel)}</b></span><span>메모리 <b>${escapeHtml(model.vramLabel)}</b></span>${downloaded ? "<span><b>내려받음</b></span>" : ""}</span>
    </button>`;
  };
  els.modelGrid.innerHTML = MODELS.map((m) => card(m, false)).join("");
  els.dialogModelGrid.innerHTML = MODELS.map((m) => card(m, true)).join("");
  const model = findModel(state.modelId);
  els.loadBtnLabel.textContent = state.downloaded.includes(model.id)
    ? `AI 켜기 · ${model.name}`
    : `AI 내려받기 · ${model.sizeLabel}`;
}

const UNSUPPORTED_TEXT = {
  "no-webgpu": "이 브라우저에는 WebGPU 기능이 없어요. 브라우저 안에서 AI를 직접 돌리는 데 꼭 필요한 기능입니다.",
  "no-adapter": "WebGPU는 있지만 이 기기의 GPU를 잡지 못했어요. 하드웨어 가속이 꺼져 있거나, 그래픽 드라이버가 오래됐을 수 있어요.",
  "adapter-error": "GPU를 확인하는 중 문제가 생겼어요. 브라우저를 다시 열면 대부분 해결됩니다.",
  timeout: "GPU 응답이 너무 늦어요. 다른 탭을 닫고 다시 확인해 주세요.",
};

async function checkBrowser() {
  showGate("checking");
  updateModelChip("idle");
  const result = await detectWebGPU();
  if (!result.ok) {
    els.gateUnsupportedReason.textContent = UNSUPPORTED_TEXT[result.reason] || UNSUPPORTED_TEXT["no-webgpu"];
    showGate("unsupported");
    els.modelChipState.textContent = "이 브라우저에서 사용 불가";
    return;
  }
  const gpuName = describeGpu(result.info);
  els.gpuText.textContent = result.hasF16 ? `${gpuName} · f16 가속 지원` : `${gpuName} · 실행 가능`;
  els.gpuText.title = gpuName;
  showGate("ready");
  updateModelChip("idle");
  // 한 번 내려받은 모델이면 바로 이어서 준비
  if (state.downloaded.includes(state.modelId)) {
    startLoading();
  }
}

let progressFrame = null;
function updateProgress(progress, text) {
  const percent = Math.round(progress * 100);
  if (progressFrame) cancelAnimationFrame(progressFrame);
  progressFrame = requestAnimationFrame(() => {
    els.progressPercent.textContent = `${percent}%`;
    els.progressPhase.textContent = phaseLabel(progress, text);
    els.progressFill.style.width = `${Math.max(1.5, progress * 100)}%`;
    els.progressText.textContent = humanizeProgress(text);
    const bar = els.progressFill.parentElement;
    bar.setAttribute("aria-valuenow", String(percent));
  });
}

function errorTips(rawMessage) {
  const li = (text) => `<li>${text}</li>`;
  if (/quota/i.test(rawMessage)) {
    return [
      "기기 저장 공간을 1~2GB 정도 비운 뒤 다시 시도해 주세요.",
      "브라우저 설정에서 이 사이트의 저장 데이터를 정리해도 도움이 됩니다.",
      "시크릿 모드에서는 모델을 저장할 공간이 더 작아요.",
    ]
      .map(li)
      .join("");
  }
  if (/integrity|hash/i.test(rawMessage)) {
    return [
      "브라우저 설정에서 이 사이트의 저장 데이터를 삭제한 뒤 다시 시도해 주세요.",
      "계속되면 네트워크 프록시나 백신이 파일을 바꾸지 않는지 확인해 주세요.",
    ]
      .map(li)
      .join("");
  }
  if (/shader-f16|WebGPUNotAvailable/i.test(rawMessage)) {
    return [
      "Chrome 또는 Edge 최신 버전인지 확인해 주세요.",
      "다른 모델을 골라 보세요.",
      "브라우저 설정에서 하드웨어 가속이 켜져 있는지 확인해 주세요.",
    ]
      .map(li)
      .join("");
  }
  return [
    "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    "다른 탭에서 무거운 작업을 닫으면 도움이 됩니다.",
    "그래도 안 되면 브라우저를 새로 고침해 주세요.",
  ]
    .map(li)
    .join("");
}

async function startLoading() {
  showGate("loading");
  updateProgress(0, "연결하는 중");
  updateModelChip("busy");
  try {
    await engine.load(state.modelId, { onProgress: ({ progress, text }) => updateProgress(progress, text) });
    if (!state.downloaded.includes(state.modelId)) state.downloaded.push(state.modelId);
    save(true);
    enterChat();
  } catch (err) {
    console.error("모델 준비 실패", err);
    els.gateErrorText.textContent = explainLoadError(err);
    els.gateErrorTips.innerHTML = errorTips(String(err?.message || err));
    showGate("error");
    updateModelChip("idle");
  }
}

function enterChat() {
  showGate("chat");
  updateModelChip("on");
  updateTopbar();
  renderChatList();
  renderMessages();
  els.prompt.focus({ preventScroll: true });
}

/* ── 메시지 렌더 ────────────────────────────────────────────────────── */
function messageRow(message) {
  if (message.role === "note") {
    return `<div class="msg-note"><span>${escapeHtml(message.text)}</span></div>`;
  }
  if (message.role === "user") {
    return `<div class="msg-row user" data-msg="${message.id}">
      <div class="msg-body">
        <div class="msg-bubble">${renderMarkdown(message.text)}</div>
        <div class="msg-meta"><span>${timeLabel(message.ts)}</span></div>
      </div>
    </div>`;
  }
  const body = message.text
    ? renderMarkdown(message.text)
    : message.streaming
      ? `<span class="typing" aria-label="답을 준비하는 중"><i></i><i></i><i></i></span>`
      : "";
  return `<div class="msg-row assistant" data-msg="${message.id}">
    <div class="msg-avatar" aria-hidden="true">${icon("spark")}</div>
    <div class="msg-body">
      <div class="msg-text${message.streaming ? " streaming" : ""}">${body}</div>
      ${message.error ? `<div class="msg-error">${icon("alert")}<span>${escapeHtml(message.error)}</span></div>` : ""}
      <div class="msg-meta">
        <span>${timeLabel(message.ts)}</span>
        ${message.stopped ? "<span>· 중단됨</span>" : ""}
      </div>
      ${message.text ? `<div class="msg-actions"><button class="msg-action" type="button" data-copy="${message.id}">${icon("copy")}<span>복사</span></button></div>` : ""}
    </div>
  </div>`;
}

function renderMessages({ scroll = false } = {}) {
  const chat = activeChat();
  const messages = chat ? chat.messages : [];
  els.messages.innerHTML = messages.map(messageRow).join("");
  const empty = messages.length === 0;
  els.emptyState.hidden = !empty;
  if (empty) renderSuggestions();
  if (scroll) scrollToBottom(true);
  maintainJumpButton();
  updateResetState();
}

function renderSuggestions() {
  const persona = findPersona(activeChat()?.persona || state.persona);
  els.emptyLead.textContent = persona.lead;
  els.suggestions.innerHTML = persona.suggestions
    .map(
      (s) => `<button class="suggestion" type="button" data-suggest="${escapeHtml(s)}">
        ${icon("spark")}<span>${escapeHtml(s)}</span>
      </button>`
    )
    .join("");
}

/* ── 스크롤 ─────────────────────────────────────────────────────────── */
let pinned = true;

function isNearBottom() {
  const el = els.thread;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}

function scrollToBottom(force = false) {
  if (!force && !pinned) return;
  els.thread.scrollTop = els.thread.scrollHeight;
  pinned = true;
  maintainJumpButton();
}

function maintainJumpButton() {
  const show = !pinned && !els.thread.hidden && els.messages.scrollHeight > els.thread.clientHeight;
  els.jumpBtn.hidden = !show;
}

els.thread.addEventListener("scroll", () => {
  pinned = isNearBottom();
  maintainJumpButton();
});

els.jumpBtn.addEventListener("click", () => {
  pinned = true;
  els.thread.scrollTo({ top: els.thread.scrollHeight, behavior: "smooth" });
  maintainJumpButton();
});

/* ── 생성 ───────────────────────────────────────────────────────────── */
let generating = false;
let currentAbort = null;
let streamFrame = null;
let streamTarget = null;

function setGenerating(value) {
  generating = value;
  els.sendBtn.classList.toggle("is-stop", value);
  els.sendBtn.setAttribute("aria-label", value ? "답변 중단" : "보내기");
  els.prompt.disabled = false;
  if (value) els.sendBtn.disabled = false;
  else updateSendAvailability();
}

function updateSendAvailability() {
  if (generating) {
    els.sendBtn.disabled = false;
    return;
  }
  els.sendBtn.disabled = els.prompt.value.trim().length === 0;
}

function scheduleStreamRender(message) {
  streamTarget = message;
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(() => {
    streamFrame = null;
    const target = streamTarget;
    if (!target || !target.streaming) return;
    const node = els.messages.querySelector(`[data-msg="${target.id}"] .msg-text`);
    if (!node) return;
    node.innerHTML = renderMarkdown(target.text);
    if (pinned) scrollToBottom(true);
  });
}

/** 아직 그리지 않은 토큰이 남아 있어도, 생성이 끝난 뒤 옛 화면을 다시 그리지 않도록 취소 */
function cancelStreamRender() {
  if (streamFrame) {
    cancelAnimationFrame(streamFrame);
    streamFrame = null;
  }
  streamTarget = null;
}

function buildMessages(chat, assistantId) {
  const persona = findPersona(chat.persona || state.persona);
  const list = chat.messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.id !== assistantId && m.text.trim()
  );
  const recent = [];
  let budget = 7000;
  for (let i = list.length - 1; i >= 0 && recent.length < HISTORY_TURNS * 2; i -= 1) {
    const m = list[i];
    budget -= m.text.length;
    if (budget < 0) break;
    recent.unshift({ role: m.role, content: m.text });
  }
  return [{ role: "system", content: persona.system }, ...recent];
}

async function sendMessage(rawText) {
  const text = String(rawText || "").trim();
  if (!text || generating) return;
  if (!engine.ready) {
    toast("AI 모델을 먼저 준비해 주세요");
    return;
  }
  const chat = ensureChat();
  if (chat.title === "새 대화") chat.title = titleFrom(text);
  addMessage(chat, "user", text);
  const assistant = addMessage(chat, "assistant", "", { streaming: true });
  save(true);
  renderMessages({ scroll: true });
  updateTopbar();
  renderChatList();

  generating = true;
  setGenerating(true);
  currentAbort = new AbortController();
  const messages = buildMessages(chat, assistant.id);

  try {
    for await (const delta of engine.generate(messages, {
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: currentAbort.signal,
    })) {
      assistant.text += delta;
      scheduleStreamRender(assistant);
    }
    if (currentAbort.signal.aborted) assistant.stopped = true;
  } catch (err) {
    console.error("생성 실패", err);
    assistant.error = explainError(err);
  } finally {
    assistant.streaming = false;
    generating = false;
    currentAbort = null;
    cancelStreamRender();
    setGenerating(false);
    save(true);
    renderMessages();
    if (pinned) scrollToBottom(true);
    updateSendAvailability();
  }
}

function stopGeneration() {
  if (!generating) return;
  currentAbort?.abort();
  engine.interrupt();
}

/* ── 모델 변경 ──────────────────────────────────────────────────────── */
async function switchModel(modelId) {
  if (!MODELS.some((m) => m.id === modelId)) return;
  if (modelId === state.modelId && engine.ready) {
    els.modelDialog.close();
    return;
  }
  state.modelId = modelId;
  save(true);
  renderModelCards();
  updateModelChip("busy");
  if (els.modelDialog.open) els.modelDialog.close();
  await startLoading();
}

/* ── 이벤트 ─────────────────────────────────────────────────────────── */
function openSidebar() {
  els.sidebar.classList.add("open");
  els.scrim.hidden = false;
}
function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.scrim.hidden = true;
}

els.menuBtn.addEventListener("click", openSidebar);
els.sideClose.addEventListener("click", closeSidebar);
els.scrim.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (els.modelDialog.open) return;
    closeSidebar();
  }
});

els.newChatBtn.addEventListener("click", () => {
  const current = activeChat();
  if (current && current.messages.length === 0) {
    closeSidebar();
    els.prompt.focus();
    return;
  }
  createChat();
  renderChatList();
  updateTopbar();
  renderMessages();
  closeSidebar();
  els.prompt.focus();
});

els.chatList.addEventListener("click", (e) => {
  const delBtn = e.target.closest("[data-del]");
  if (delBtn) {
    const id = delBtn.getAttribute("data-del");
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    if (!window.confirm(`"${chat.title}" 대화를 삭제할까요?`)) return;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.activeId === id) {
      state.activeId = sortedChats()[0]?.id || null;
    }
    save(true);
    renderChatList();
    updateTopbar();
    renderMessages();
    return;
  }
  const openBtn = e.target.closest("[data-chat]");
  if (openBtn) {
    const id = openBtn.getAttribute("data-chat");
    if (!state.chats.some((c) => c.id === id)) return;
    state.activeId = id;
    state.persona = findPersona(state.chats.find((c) => c.id === id)?.persona).id;
    save();
    renderChatList();
    renderPersonas();
    updateTopbar();
    renderMessages();
    closeSidebar();
  }
});

els.chatList.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const openBtn = e.target.closest("[data-chat]");
  if (!openBtn) return;
  e.preventDefault();
  openBtn.click();
});

els.personaList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-persona]");
  if (!btn) return;
  const persona = findPersona(btn.getAttribute("data-persona"));
  state.persona = persona.id;
  const chat = activeChat();
  if (chat) {
    chat.persona = persona.id;
    chat.updatedAt = Date.now();
    if (chat.messages.some((m) => m.role !== "note")) {
      addMessage(chat, "note", `AI 성격을 "${persona.name}"(으)로 바꿨어요`);
    }
  }
  save(true);
  renderPersonas();
  updateTopbar();
  renderMessages();
  toast(`AI 성격 · ${persona.name}`);
});

els.resetBtn.addEventListener("click", () => {
  const chat = activeChat();
  if (!chat || chat.messages.length === 0) {
    toast("비울 대화가 없어요");
    return;
  }
  if (!window.confirm("이 대화의 내용을 모두 지울까요? 되돌릴 수 없어요.")) return;
  chat.messages = [];
  chat.title = "새 대화";
  chat.updatedAt = Date.now();
  save(true);
  renderChatList();
  updateTopbar();
  renderMessages();
  els.prompt.focus();
});

els.modelChip.addEventListener("click", () => {
  renderModelCards();
  if (typeof els.modelDialog.showModal === "function") els.modelDialog.showModal();
});

els.dialogModelGrid.addEventListener("click", (e) => {
  const card = e.target.closest("[data-model]");
  if (!card) return;
  switchModel(card.getAttribute("data-model"));
});

els.modelGrid.addEventListener("click", (e) => {
  const card = e.target.closest("[data-model]");
  if (!card) return;
  state.modelId = card.getAttribute("data-model");
  save(true);
  renderModelCards();
  updateModelChip("idle");
});

els.loadBtn.addEventListener("click", () => {
  if (engine.loading) return;
  startLoading();
});

els.recheckBtn.addEventListener("click", () => checkBrowser());

els.retryBtn.addEventListener("click", () => startLoading());
els.errorBackBtn.addEventListener("click", () => {
  showGate("ready");
  updateModelChip("idle");
});

els.suggestions.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-suggest]");
  if (!chip) return;
  els.prompt.value = chip.getAttribute("data-suggest");
  autoGrow();
  updateSendAvailability();
  els.prompt.focus();
});

els.messages.addEventListener("click", async (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (!copyBtn) return;
  const id = copyBtn.getAttribute("data-copy");
  const chat = activeChat();
  const message = chat?.messages.find((m) => m.id === id);
  if (!message) return;
  try {
    await navigator.clipboard.writeText(message.text);
    copyBtn.classList.add("copied");
    copyBtn.querySelector("span").textContent = "복사됨";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.querySelector("span").textContent = "복사";
    }, 1600);
  } catch {
    toast("복사하지 못했어요. 길게 눌러 선택해 주세요");
  }
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (generating) {
    stopGeneration();
    return;
  }
  const text = els.prompt.value;
  els.prompt.value = "";
  autoGrow();
  updateSendAvailability();
  sendMessage(text);
});

els.prompt.addEventListener("input", () => {
  autoGrow();
  updateSendAvailability();
});

els.prompt.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (generating) return;
  els.composer.requestSubmit();
});

function autoGrow() {
  const el = els.prompt;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
}

/* ── 시작 ───────────────────────────────────────────────────────────── */
function boot() {
  if (!state.chats.length) {
    state.activeId = null;
  } else if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = sortedChats()[0].id;
  }
  if (!MODELS.some((m) => m.id === state.modelId)) state.modelId = DEFAULT_MODEL_ID;

  renderChatList();
  renderPersonas();
  renderModelCards();
  updateModelChip("idle");
  updateTopbar();
  renderMessages();
  showGate("checking");
  checkBrowser();
}

boot();

// 테스트·디버깅용 (앱 동작에는 영향 없음)
window.__moa = {
  get state() {
    return state;
  },
  get engineReady() {
    return engine.ready;
  },
  engine,
};
