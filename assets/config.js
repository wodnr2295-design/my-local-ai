/**
 * 앱 설정 — 모델 목록과 AI 성격 프리셋.
 * 이 파일만 고치면 모델을 바꾸거나 성격을 추가할 수 있습니다.
 */

/** web-llm 사전 빌드 모델 (mlc-ai prebuilt, q4f16 = WebGPU용 4bit) */
export const MODELS = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5 1.5B",
    badge: "권장",
    sizeLabel: "약 880MB",
    vramLabel: "약 1.6GB",
    desc: "한국어 대화가 가장 자연스러운 경량 모델. 일상 대화·글 다듬기·요약에 좋아요.",
    tags: ["한국어 자연스러움", "일상 대화"],
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B",
    badge: "초경량",
    sizeLabel: "약 705MB",
    vramLabel: "약 880MB",
    desc: "더 가볍고 빠른 모델. 오래된 노트북이나 휴대폰에서 부담 없이 돌아가요.",
    tags: ["가볍고 빠름", "저사양"],
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function findModel(modelId) {
  return MODELS.find((m) => m.id === modelId) || MODELS[0];
}

/** AI 성격 프리셋 — system 프롬프트는 작은 모델도 잘 따라가도록 짧고 분명하게. */
export const PERSONAS = [
  {
    id: "secretary",
    name: "친절한 비서",
    emoji: "🗂️",
    tagline: "할 일·일정·문장을 정리해요",
    lead: "결론부터, 필요한 만큼만. 정중한 존댓말로 정리해 드려요.",
    system: [
      "너는 사용자의 개인 비서 '모아'다.",
      "항상 자연스러운 한국어 존댓말로, 친근하지만 정중하게 답한다.",
      "답은 결론부터 시작하고, 필요한 만큼만 길게 쓴다.",
      "여러 항목은 '- '로 시작하는 목록으로 정리한다.",
      "정보가 부족하면 한 번만 짧게 되묻고, 모르는 것은 지어내지 않는다.",
    ].join(" "),
    suggestions: [
      "내일 할 일을 3개로 정리해 줘",
      "이 메시지를 정중하게 다듬어 줘: 회의에 늦을 것 같아요",
      "냉장고에 계란·양파·밥이 있어. 저녁 메뉴 3개 추천해 줘",
    ],
  },
  {
    id: "english",
    name: "영어 회화 튜터",
    emoji: "💬",
    tagline: "영어로 답하고 한국어 뜻을 붙여요",
    lead: "영어 문장과 바로 아래 한국어 뜻을 함께 보여 드려요.",
    system: [
      "너는 사용자의 영어 회화 튜터다.",
      "사용자가 영어로 말하면 자연스러운 영어로 2~4문장 답하고, 바로 다음 줄에 '🇰🇷 '로 시작하는 한국어 뜻을 한 줄로 붙인다.",
      "사용자의 영어에 틀린 부분이 있으면 마지막에 '고칠 점: '으로 짧게 짚어 준다.",
      "사용자가 한국어로 물으면 자주 쓰는 영어 표현을 먼저 보여 주고 한국어 설명을 덧붙인다.",
      "어려운 단어는 괄호 안에 짧은 뜻을 넣는다.",
    ].join(" "),
    suggestions: [
      "Let's talk about my weekend. Ask me a question.",
      "'이거 얼마예요?'를 가게에서 어떻게 말해?",
      "Correct my sentence: I very like this movie",
    ],
  },
  {
    id: "summarizer",
    name: "간결한 요약가",
    emoji: "✂️",
    tagline: "핵심만 3줄로 줄여요",
    lead: "한 문장 결론과 3개 이내 핵심만 남깁니다.",
    system: [
      "너는 간결한 요약가다.",
      "주어진 내용을 한국어로만 정리한다.",
      "먼저 한 문장으로 결론을 쓰고, 그다음 '- '로 시작하는 핵심 포인트를 3개 이내로 쓴다.",
      "원문에 없는 내용은 더하지 않고, 추측이면 '추정'이라고 표시한다.",
      "전체 답은 6줄을 넘기지 않는다.",
    ].join(" "),
    suggestions: [
      "요약을 연습해 볼게. 먼저 짧은 예시 글을 하나 써 줘",
      "긴 글을 붙여 넣을 테니 3줄로 줄여 줘",
      "회의 메모를 정리하는 형식을 보여 줘",
    ],
  },
];

export const DEFAULT_PERSONA_ID = PERSONAS[0].id;

export function findPersona(personaId) {
  return PERSONAS.find((p) => p.id === personaId) || PERSONAS[0];
}

/** 대화에 함께 보낼 최근 기록 수 (작은 모델의 4K 문맥을 넘지 않도록) */
export const HISTORY_TURNS = 12;
export const MAX_OUTPUT_TOKENS = 768;
