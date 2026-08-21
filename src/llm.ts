import * as vscode from 'vscode';

export interface LLMConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface DraftInput {
  repo: string;
  branch: string;
  files: string[];
  diff: string;
  commit?: string;
}

export interface DraftResult {
  title: string;
  problem: string;
  rootCause: string;
  solution: string;
  lesson: string;
  tags: string[];
  star: { situation: string; task: string; action: string; result: string };
}

// 检查字符串是否只含 ASCII（HTTP 头要求 Latin-1，API Key 应为纯 ASCII）
function isASCII(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
}

// 常用模型预设（OpenAI 兼容接口）。baseURL 以 /v1 或无后缀均可，调用时会规范化。
export const PROVIDER_PRESETS: {
  label: string;
  value: string;
  baseURL: string;
  model: string;
}[] = [
  { label: 'DeepSeek（推荐·代码强·便宜）', value: 'deepseek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', value: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '通义千问 Qwen（阿里云）', value: 'qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', value: 'zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'Kimi 月之暗面', value: 'moonshot', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '自定义（填 base URL 与模型）', value: 'custom', baseURL: '', model: '' },
];

export async function getLLMConfig(context: vscode.ExtensionContext): Promise<LLMConfig | null> {
  const apiKey = await context.secrets.get('growthLog.apiKey');
  const cfg = vscode.workspace.getConfiguration('growthLog');
  const baseURL = (cfg.get<string>('baseUrl') || '').trim();
  const model = (cfg.get<string>('model') || '').trim();
  const provider = (cfg.get<string>('provider') || '').trim();
  if (!apiKey || !baseURL || !model) {
    return null;
  }
  return { provider, baseURL, apiKey, model };
}

export async function saveLLMConfig(
  context: vscode.ExtensionContext,
  cfg: LLMConfig
): Promise<void> {
  await context.secrets.store('growthLog.apiKey', cfg.apiKey);
  const section = vscode.workspace.getConfiguration('growthLog');
  await section.update('provider', cfg.provider, vscode.ConfigurationTarget.Global);
  await section.update('baseUrl', cfg.baseURL, vscode.ConfigurationTarget.Global);
  await section.update('model', cfg.model, vscode.ConfigurationTarget.Global);
}

function normalizeURL(base: string): string {
  let u = (base || '').trim();
  if (!u) {
    return '';
  }
  u = u.replace(/\/+$/, '');
  // 兼容只填了域名没有 /v1 的情况
  if (!/\/v\d+$/.test(u) && !u.endsWith('/chat/completions')) {
    // 不做强制补全，保持用户意图
  }
  return u;
}

function extractJSON(text: string): any {
  let t = (text || '').trim();
  // 去掉 markdown 代码围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

// 调用 OpenAI 兼容接口，从代码改动起草一条成长记录
export async function draftFromContext(cfg: LLMConfig, input: DraftInput): Promise<DraftResult> {
  const base = normalizeURL(cfg.baseURL);
  if (!base) {
    throw new Error('baseURL 未配置');
  }
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    throw new Error('API Key 未配置，请先执行「成长记录：配置 AI 模型」');
  }
  if (!isASCII(cfg.apiKey)) {
    throw new Error('API Key 包含非英文字符（中文/全角等），无法用于 HTTP 认证。请重新执行「成长记录：配置 AI 模型」填入正确的 Key');
  }
  const url = base.replace(/\/chat\/completions$/, '') + '/chat/completions';
  const sys =
    '你是一名资深技术面试官兼代码教练。用户会给你一段 git 改动（diff）及提交信息，' +
    '请提炼成一条"成长记录"，用于面试时展示解决问题的能力。\n' +
    '必须只输出一个 JSON 对象，不要额外说明，字段如下：\n' +
    '{\n' +
    '  "title": "一句话标题，概括这次成长",\n' +
    '  "problem": "遇到了什么问题/现象（客观描述）",\n' +
    '  "rootCause": "根因分析（为什么会出现这个问题）",\n' +
    '  "solution": "你是怎么解决的（关键改动与思路）",\n' +
    '  "lesson": "沉淀下来的经验，以后如何避免或复用的思考",\n' +
    '  "star": {\n' +
    '    "situation": "面试话术·当时面临什么背景/约束（1-2句）",\n' +
    '    "task": "面试话术·我要达成的具体目标（1句）",\n' +
    '    "action": "面试话术·我采取的关键行动与决策（1-2句）",\n' +
    '    "result": "面试话术·可量化的结果与收益（1句）"\n' +
    '  },\n' +
    '  "tags": ["3-6 个中文标签，如 性能/并发/Debug/重构/Spring"]\n' +
    '}\n' +
    '要求：语言简练、有技术深度、避免空话套话；rootCause 与 lesson 尤其要有洞察。';
  const user =
    `仓库：${input.repo || 'unknown'}  分支：${input.branch || '-'}\n` +
    `提交信息：${input.commit ? input.commit.slice(0, 12) : '（无）'}\n` +
    `改动文件：${(input.files || []).join(', ') || '（未知）'}\n\n` +
    `--- diff 开始 ---\n${input.diff.slice(0, 12000)}\n--- diff 结束 ---`;

  const body: any = {
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
  };
  // 主流厂商支持 json_object；不支持的会忽略，extractJSON 仍可靠
  body.response_format = { type: 'json_object' };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: any) {
    throw new Error('网络请求失败：' + (e?.message || String(e)));
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('HTTP ' + resp.status + '：' + txt.slice(0, 240));
  }
  const data: any = await resp.json().catch(() => ({}));
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJSON(content);
  const rawStar = parsed.star || {};
  return {
    title: String(parsed.title || '').trim(),
    problem: String(parsed.problem || '').trim(),
    rootCause: String(parsed.rootCause || '').trim(),
    solution: String(parsed.solution || '').trim(),
    lesson: String(parsed.lesson || '').trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean)
      : [],
    star: {
      situation: String(rawStar.situation || '').trim(),
      task: String(rawStar.task || '').trim(),
      action: String(rawStar.action || '').trim(),
      result: String(rawStar.result || '').trim(),
    },
  };
}

// 「成长记录：配置 AI 模型」命令：交互式引导用户选择厂商并填入 key
export async function runConfigureLLM(context: vscode.ExtensionContext): Promise<void> {
  const providerPick = await vscode.window.showQuickPick(
    PROVIDER_PRESETS.map((p) => ({
      label: p.label,
      value: p.value,
      baseURL: p.baseURL,
      model: p.model,
    })),
    { placeHolder: '选择 AI 模型厂商（OpenAI 兼容接口）' }
  );
  if (!providerPick) {
    return;
  }
  let baseURL = providerPick.baseURL;
  let model = providerPick.model;
  if (providerPick.value === 'custom') {
    baseURL = (await vscode.window.showInputBox({
      prompt: '填写 API base URL（如 https://api.xxx.com/v1）',
      ignoreFocusOut: true,
    })) || '';
    if (!baseURL) {
      return;
    }
    model = (await vscode.window.showInputBox({
      prompt: '填写模型名（如 gpt-4o-mini）',
      ignoreFocusOut: true,
    })) || '';
    if (!model) {
      return;
    }
  } else {
    // 允许覆盖默认模型
    const override = await vscode.window.showInputBox({
      prompt: `模型名（默认 ${model}，可直接回车）`,
      value: model,
      ignoreFocusOut: true,
    });
    if (override === undefined) {
      return;
    }
    model = override || model;
  }
  const apiKey = await vscode.window.showInputBox({
    prompt: `填写 ${providerPick.label} 的 API Key`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!apiKey) {
    return;
  }

  // 校验 Key 只含 ASCII（HTTP 头不允许非 Latin-1 字符）
  if (!isASCII(apiKey.trim())) {
    vscode.window.showErrorMessage(
      'API Key 包含非英文字符（中文/全角等），已取消保存。请检查是否复制了多余的中文内容，重新执行「成长记录：配置 AI 模型」'
    );
    return;
  }

  await saveLLMConfig(context, {
    provider: providerPick.value,
    baseURL,
    apiKey: apiKey.trim(),
    model,
  });
  vscode.window.showInformationMessage(`✅ 已保存 ${providerPick.label} 配置（模型 ${model}）。提交代码或点「✨ AI 起草」即可自动生成`);
}
