/**
 * 브라우저 내장 AI 엔진 래퍼.
 * - @mlc-ai/web-llm 을 CDN에서 ESM으로 불러옵니다 (빌드 도구·서버·API 키 없음).
 * - WebGPU 지원 여부를 먼저 확인하고, 모델 로딩 진행률을 사람이 읽을 수 있게 바꿔 전달합니다.
 */

export const WEBLLM_SOURCES = [
  "https://esm.run/@mlc-ai/web-llm@0.2.89",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/+esm",
];

let libPromise = null;

export function getWebLLM() {
  if (!libPromise) {
    libPromise = (async () => {
      const failures = [];
      for (const url of WEBLLM_SOURCES) {
        try {
          const lib = await import(/* @vite-ignore */ url);
          if (!lib || typeof lib.CreateMLCEngine !== "function") {
            throw new Error("CreateMLCEngine을 찾지 못했습니다.");
          }
          return lib;
        } catch (err) {
          failures.push(`${url} → ${err?.message || err}`);
        }
      }
      throw new Error(
        "AI 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.\n" +
          failures.join("\n")
      );
    })();
  }
  return libPromise;
}

/* ── WebGPU 확인 ─────────────────────────────────────────────────────── */

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * @returns {Promise<{ok: true, info: object, hasF16: boolean} | {ok: false, reason: string, detail?: string}>}
 */
export async function detectWebGPU() {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    return { ok: false, reason: "no-webgpu" };
  }
  let adapter = null;
  try {
    adapter = await withTimeout(
      navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
      8000
    );
  } catch (err) {
    return { ok: false, reason: "adapter-error", detail: String(err?.message || err) };
  }
  if (!adapter) return { ok: false, reason: "no-adapter" };

  let info = {};
  try {
    info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {}) || {};
  } catch {
    info = {};
  }
  let hasF16 = false;
  try {
    hasF16 = adapter.features ? Array.from(adapter.features).includes("shader-f16") : false;
  } catch {
    hasF16 = false;
  }
  return { ok: true, info, hasF16 };
}

const VENDORS = {
  apple: "Apple",
  arm: "ARM",
  amd: "AMD",
  intel: "Intel",
  nvidia: "NVIDIA",
  qualcomm: "Qualcomm",
  imagination: "Imagination",
  "microsoft": "Microsoft",
  google: "Google",
};

export function describeGpu(info = {}) {
  const vendor = VENDORS[String(info.vendor || "").toLowerCase()] || "";
  const arch = info.architecture ? String(info.architecture) : "";
  if (vendor && arch) return `${vendor} GPU (${arch})`;
  if (vendor) return `${vendor} GPU`;
  if (arch && arch !== "unknown") return `GPU (${arch})`;
  return "이 기기의 GPU";
}

/* ── 진행률 문구 ─────────────────────────────────────────────────────── */

/** web-llm의 기술적인 영어 로그를 화면용 한국어로 바꿉니다. */
export function humanizeProgress(text) {
  const raw = String(text || "").trim();
  let m;
  if ((m = raw.match(/Fetching param cache\[(\d+)\/(\d+)\]/))) {
    return `모델 파일을 내려받는 중 (${m[1]}/${m[2]})`;
  }
  if ((m = raw.match(/Loading model from cache\[(\d+)\/(\d+)\]/))) {
    return `기기에 저장된 모델을 불러오는 중 (${m[1]}/${m[2]})`;
  }
  if ((m = raw.match(/Loading GPU shader modules\[(\d+)\/(\d+)\]/))) {
    return `GPU 셰이더를 준비하는 중 (${m[1]}/${m[2]})`;
  }
  if (/^Finish loading/i.test(raw)) return "마무리하고 있어요";
  if (/^Fetching param cache/i.test(raw)) return "모델 파일을 내려받는 중";
  if (/^Loading model from cache/i.test(raw)) return "기기에 저장된 모델을 불러오는 중";
  if (/^Loading GPU shader/i.test(raw)) return "GPU 셰이더를 준비하는 중";
  if (/^Using indexdDB/i.test(raw)) return "저장 공간을 확인하는 중";
  return raw || "준비하고 있어요";
}

export function phaseLabel(progress, text) {
  const p = Number(progress) || 0;
  if (p >= 0.999) return "마무리 중";
  if (/Loading model from cache/i.test(String(text))) return "기기에서 불러오는 중";
  if (p < 0.02) return "연결하는 중";
  if (p < 0.9) return "모델 내려받는 중";
  return "거의 다 됐어요";
}

/* ── 엔진 ───────────────────────────────────────────────────────────── */

export class LocalEngine {
  #engine = null;
  #lib = null;
  modelId = null;
  loading = false;

  get ready() {
    return Boolean(this.#engine) && !this.loading;
  }

  async load(modelId, { onProgress } = {}) {
    if (this.loading) throw new Error("이미 모델을 준비하고 있어요.");
    this.loading = true;
    try {
      const lib = await getWebLLM();
      this.#lib = lib;
      const callback =
        typeof onProgress === "function"
          ? (report) => {
              try {
                onProgress({
                  progress: Math.min(1, Math.max(0, Number(report?.progress) || 0)),
                  text: report?.text || "",
                  timeElapsed: Number(report?.timeElapsed) || 0,
                });
              } catch (err) {
                console.warn("progress callback error", err);
              }
            }
          : undefined;

      if (this.#engine) {
        // 이미 엔진이 있으면 모델만 교체 (기존 GPU 자원은 내부에서 정리)
        this.#engine.setInitProgressCallback(callback);
        this.modelId = modelId;
        await this.#engine.reload(modelId);
      } else {
        this.#engine = await lib.CreateMLCEngine(modelId, {
          initProgressCallback: callback,
          logLevel: "WARN",
        });
        this.modelId = modelId;
      }
      return this.#engine;
    } finally {
      this.loading = false;
    }
  }

  /**
   * 스트리밍 생성. for await 로 토큰 조각을 받습니다.
   * @param {{role: string, content: string}[]} messages
   */
  async *generate(messages, { temperature = 0.7, maxTokens = 768, signal } = {}) {
    if (!this.#engine) throw new Error("모델이 아직 준비되지 않았어요.");
    const chunks = await this.#engine.chat.completions.create({
      messages,
      stream: true,
      temperature,
      top_p: 0.9,
      max_tokens: maxTokens,
    });
    for await (const chunk of chunks) {
      if (signal?.aborted) break;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async interrupt() {
    try {
      await this.#engine?.interruptGenerate();
    } catch (err) {
      console.warn("interrupt failed", err);
    }
  }

  async unload() {
    try {
      await this.#engine?.unload();
    } catch (err) {
      console.warn("unload failed", err);
    }
    this.#engine = null;
    this.modelId = null;
  }
}

/** 모델을 준비(다운로드·로딩)하다 난 오류를 화면용 문장으로 */
export function explainLoadError(err) {
  const msg = String(err?.message || err || "");
  if (/QuotaExceeded|quota/i.test(msg)) {
    return "브라우저 저장 공간이 부족해 모델을 저장하지 못했어요. 기기 저장 공간을 1~2GB 정도 비우고 다시 시도해 주세요.";
  }
  if (/ShaderF16|shader-f16/i.test(msg)) {
    return "이 기기의 GPU가 모델 정밀도(f16)를 지원하지 않아요. 다른 모델을 골라 보세요.";
  }
  if (/WebGPUNotAvailable|WebGPU is not supported|no adapter/i.test(msg)) {
    return "WebGPU를 사용할 수 없어요. Chrome 또는 Edge를 최신 버전으로 업데이트해 주세요.";
  }
  if (/IntegrityError|integrity|hash/i.test(msg)) {
    return "모델 파일이 손상되었어요. 브라우저 저장 데이터를 지운 뒤 다시 시도해 주세요.";
  }
  if (/out of memory|OOM|Allocation|buffer size/i.test(msg)) {
    return "GPU 메모리가 부족해요. 다른 탭을 닫거나 더 가벼운 모델(Llama 3.2 1B)을 골라 보세요.";
  }
  if (/fetch|network|Failed to load|404|CORS|timeout/i.test(msg)) {
    return "모델 파일을 내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
  }
  return `모델을 준비하지 못했어요. ${msg.split("\n")[0].slice(0, 160)}`;
}

/** 모델 오류를 사용자가 읽을 수 있는 문장으로 */
export function explainError(err) {
  const msg = String(err?.message || err || "");
  if (/out of memory|OOM|Allocation|buffer size/i.test(msg)) {
    return "GPU 메모리가 부족해요. 다른 탭을 닫거나 더 가벼운 모델(Llama 3.2 1B)로 바꿔 보세요.";
  }
  if (/context|length|token/i.test(msg) && /exceed|long|overflow/i.test(msg)) {
    return "대화가 너무 길어졌어요. 새 대화를 시작하면 이어서 답할 수 있어요.";
  }
  if (/network|fetch|Failed to load|404|CORS/i.test(msg)) {
    return "모델 파일을 내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
  }
  if (/WebGPU|device lost|adapter/i.test(msg)) {
    return "GPU 연결이 끊겼어요. 브라우저를 새로 고친 뒤 다시 시도해 주세요.";
  }
  return "답을 만들다가 문제가 생겼어요. 잠시 뒤 다시 보내 주세요.";
}
