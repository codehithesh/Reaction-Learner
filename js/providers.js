// ============================================================
// PROVIDERS — BYOK evaluation backends
// ============================================================
// style 'chat'     = OpenAI-compatible /chat/completions (Bearer auth)
// style 'messages' = Anthropic Messages API (anthropic-version header)
// json / temp      = whether the API accepts response_format + temperature;
//                    callChat retries bare if a model rejects either.
// The wire format itself lives in js/api.js.
//
// Every backend below is OpenAI-compatible chat completions except Anthropic,
// which speaks the Messages API. Adding one is therefore just the endpoint, the
// model ids, and any parameter the model rejects (noTemp / noJson).

'use strict';

const PROVIDERS = [
  {
    id: 'openai', label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'gpt-4o',
    noTemp: (m) => /^o[134]/.test(m),
    hint: 'Chat Completions. Reasoning models fall back to gpt-4o automatically if your key rejects them.',
    ph: 'sk-...',
    models: [
      { v: 'o3-mini', l: 'o3-mini (reasoning)' },
      { v: 'o4-mini', l: 'o4-mini (reasoning)' },
      { v: 'gpt-4o', l: 'gpt-4o (fast)' },
    ],
  },
  {
    id: 'anthropic', label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    style: 'messages', json: false, temp: false,
    fallback: 'claude-sonnet-5',
    def: 'claude-sonnet-5',
    hint: 'Messages API (console.anthropic.com). Direct browser access is requested explicitly, and JSON is asked for inside the prompt.',
    ph: 'sk-ant-...',
    models: [
      { v: 'claude-fable-5-1', l: 'Fable 5.1 — deepest reasoning' },
      { v: 'claude-opus-5', l: 'Opus 5 — strongest overall' },
      { v: 'claude-sonnet-5', l: 'Sonnet 5 — speed + intelligence' },
      { v: 'claude-haiku-4-5-20251001', l: 'Haiku 4.5 — fastest' },
    ],
  },
  {
    id: 'google', label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    style: 'chat', json: true, temp: false,
    fallback: 'gemini-2.5-flash',
    hint: 'OpenAI-compatible endpoint; key from Google AI Studio (aistudio.google.com/apikey).',
    ph: 'AIza...',
    models: [
      { v: 'gemini-3.8-flash', l: 'Gemini 3.8 Flash' },
      { v: 'gemini-3.1-pro', l: 'Gemini 3.1 Pro' },
      { v: 'gemini-3-flash', l: 'Gemini 3 Flash' },
      { v: 'gemini-2.5-flash', l: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'deepseek', label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'deepseek-chat',
    noTemp: (m) => m === 'deepseek-reasoner',
    hint: 'Chat Completions. Both current models support response_format; the reasoner takes no temperature.',
    ph: 'sk-...',
    models: [
      { v: 'deepseek-reasoner', l: 'deepseek-reasoner (R1)' },
      { v: 'deepseek-chat', l: 'deepseek-chat (V3)' },
    ],
  },
  {
    id: 'moonshot', label: 'Moonshot (Kimi)',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'kimi-k2.6',
    noTemp: (m) => m === 'kimi-k3',
    hint: 'OpenAI-compatible; international endpoint (api.moonshot.ai).',
    ph: 'sk-...',
    models: [
      { v: 'kimi-k2.6', l: 'Kimi K2.6 (reasoning)' },
      { v: 'kimi-k3', l: 'Kimi K3 (1M context)' },
    ],
  },
  {
    id: 'grok', label: 'Grok',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'grok-4.3',
    hint: 'OpenAI-compatible xAI endpoint. grok-4.3 is the fallback where 4.5/4.6 are unavailable to your account.',
    ph: 'xai-...',
    models: [
      { v: 'grok-4.6', l: 'Grok 4.6' },
      { v: 'grok-4.5', l: 'Grok 4.5' },
      { v: 'grok-4.3', l: 'Grok 4.3' },
    ],
  },
  {
    id: 'qwen', label: 'Qwen',
    endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'qwen-plus',
    hint: 'Alibaba Model Studio (Singapore), OpenAI-compatible.',
    ph: 'sk-...',
    models: [
      { v: 'qwen3-max', l: 'Qwen3 Max' },
      { v: 'qwen-plus', l: 'Qwen Plus' },
      { v: 'qwen-flash', l: 'Qwen Flash (fast)' },
    ],
  },
  {
    id: 'zai', label: 'Z.ai',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'glm-5.3-flash',
    hint: 'Zhipu GLM, OpenAI-compatible (api.z.ai).',
    ph: '...',
    models: [
      { v: 'glm-5.3', l: 'GLM-5.3' },
      { v: 'glm-5.3-flash', l: 'GLM-5.3 Flash (fast)' },
      { v: 'glm-5.2', l: 'GLM-5.2' },
    ],
  },
  {
    id: 'muse', label: 'Muse Spark',
    endpoint: 'https://api.meta.ai/v1/chat/completions',
    style: 'chat', json: true, temp: true,
    fallback: 'muse-spark-1.1',
    hint: 'Meta Model API (api.meta.ai), OpenAI-compatible. Contributor pricing trades a discount for training-data use.',
    ph: '...',
    models: [
      { v: 'muse-spark-1.3', l: 'Muse Spark 1.3' },
      { v: 'muse-spark-1.3-contributor', l: 'Muse Spark 1.3 Contributor' },
      { v: 'muse-spark-1.1', l: 'Muse Spark 1.1' },
    ],
  },
];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

// ---------- the provider inputs rendered in Settings ----------
function providerInput(id) { return document.getElementById('key-' + id); }
function providerModel(id) { return document.getElementById('model-' + id); }

function modelOptions(p, selected) {
  const def = selected || p.def || p.models[0].v;
  return p.models.map((m) =>
    `<option value="${m.v}"${m.v === def ? ' selected' : ''}>${m.l}</option>`
  ).join('');
}

// The provider + key + model currently selected in the Settings modal.
function activeProvider() {
  const cfg = PROVIDER_MAP[state.provider];
  return {
    name: cfg.id,
    label: cfg.label,
    // sanitized on the way out: this object is the only thing that becomes an
    // Authorization header, so cleaning here covers every path into the field —
    // a paste, a key restored from storage, or a hand-edited entry
    key: sanitizeKey(providerInput(cfg.id).value).key,
    model: providerModel(cfg.id).value,
  };
}
