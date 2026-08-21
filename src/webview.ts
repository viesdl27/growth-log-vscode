import * as vscode from 'vscode';
import { Entry } from './store';
import { RepoInfo } from './git';

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

const STYLE = `
  :root {
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --line: var(--vscode-panel-border);
    --bg: var(--vscode-editor-background);
    --soft: var(--vscode-textCodeBlock-background);
    --accent: var(--vscode-textLink-foreground);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-line: var(--vscode-input-border, var(--vscode-panel-border));
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
  }
  html { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         color: var(--fg); background: var(--bg); padding: 18px 22px 28px; line-height: 1.55; max-width: 820px; }
  h1 { font-size: 19px; margin: 0; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  .field { margin: 0 0 18px; }
  .field .lbl { display: flex; align-items: baseline; gap: 8px; font-weight: 600; font-size: 13px; margin: 0 0 6px; }
  .field .lbl .hint { color: var(--muted); font-weight: 400; font-size: 12px; }
  .field .lbl .count { margin-left: auto; font-weight: 400; color: var(--muted); font-size: 11px; }
  .field .count.weak { color: var(--accent); }
  .group { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin-bottom: 18px; background: var(--bg); }
  .group .legend { font-size: 11px; color: var(--muted); margin-bottom: 10px; padding: 0 0 8px; border-bottom: 1px dashed var(--line); }
  .group.grow { background: var(--soft); border-style: dashed; }
  input[type=text], textarea {
    width: 100%; box-sizing: border-box; border: 1px solid var(--input-line);
    border-radius: 6px; padding: 8px 10px; font: inherit; background: var(--input-bg); color: var(--input-fg);
    transition: border-color .12s;
  }
  input[type=text]:focus, textarea:focus { outline: 0; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 60px; line-height: 1.5; }
  textarea.tall { min-height: 88px; }
  .ctx { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted);
         white-space: pre-wrap; max-height: 200px; overflow: auto; line-height: 1.5; }
  details.ctx-wrap { margin: 0; }
  details.ctx-wrap[open] summary { margin-bottom: 8px; }
  details.ctx-wrap summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .warn { background: var(--soft); border-left: 3px solid var(--accent);
          padding: 10px 14px; font-size: 12px; color: var(--fg); margin: 0 0 18px; border-radius: 4px; }
  .warn b { color: var(--accent); }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); }
  button {
    background: var(--btn-bg); color: var(--btn-fg); border: 0; border-radius: 6px;
    padding: 8px 18px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: var(--btn-hover); }
  button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--input-line); }
  button.ghost:hover { background: var(--soft); }
  button.ai { color: var(--accent); border-color: var(--accent); }
  button.ai:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .tag { display: inline-block; background: var(--badge-bg); color: var(--badge-fg); border-radius: 999px;
         padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; }
  .k { font-weight: 600; color: var(--muted); display: inline-block; min-width: 56px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin: 0 0 10px; background: var(--bg); }
  .card .body { padding-top: 4px; }
  .star { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin: 0 0 10px; font-size: 13px; }
  .star p { margin: 4px 0; }
  .star b { color: var(--accent); }
  .empty { color: var(--muted); font-style: italic; font-size: 13px; }
`;

export function formHtml(
  repo: RepoInfo,
  diff: string,
  webview: vscode.Webview,
  entry?: Entry
): string {
  const nonce = getNonce();
  const isEdit = !!entry;
  const ctxText = entry?.context
    ? `仓库：${entry.context.repo || 'unknown'}${entry.context.branch ? '  分支：' + entry.context.branch : ''}\n${entry.context.diff
      ? '--- 已保存的代码上下文 ---\n' + entry.context.diff.slice(0, 4000)
      : ''
    }`
    : `仓库：${repo.repo || 'unknown'}${repo.branch ? '  分支：' + repo.branch : ''}\n${diff ? '--- 已捕获的代码上下文（提交时一并存入，可作参考）---\n' + diff.slice(0, 4000) : '（无选区 / diff，可手动粘贴代码）'
    }`;

  const v = (s?: string) => escapeHtml(s || '');
  const heading = isEdit ? '编辑成长记录' : '记录这次成长';
  const subDesc = isEdit
    ? '修改下方字段后点保存即可更新该记录。'
    : '把「问题 / 根因 / 方案 / 收获」讲清楚——面试最能打动人的是这段话，不是你改了多少行。';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
  <div class="header"><h1>${heading}</h1></div>
  <div class="sub">${subDesc}</div>

  <div class="row">
    <button id="ai" class="ai ghost" type="button">✨ AI 起草</button>
    <span class="sub" style="margin:0">已配置模型时，按上方代码上下文自动起草问题/方案</span>
  </div>

  <h2>基本信息</h2>
  <div class="group">
    <div class="field">
      <div class="lbl">标题 <span class="hint">一句话概括</span></div>
      <input type="text" id="title" placeholder="如：用 Lombok 消除实体类样板代码" value="${v(entry?.title)}" autofocus />
    </div>
    <div class="field">
      <div class="lbl">标签 <span class="hint">逗号或空格分隔，如：重构, 代码质量, Java</span></div>
      <input type="text" id="tags" placeholder="重构, 代码质量, Java" value="${v((entry?.tags || []).join(', '))}" />
    </div>
  </div>

  <h2>反思框架</h2>
  <div class="group">
    <div class="field">
      <div class="lbl">问题 <span class="hint">遇到了什么现象 / 痛点</span></div>
      <textarea id="problem" class="tall" placeholder="把场景讲清楚：什么环境、什么输入、出现什么结果。">${v(entry?.problem)}</textarea>
    </div>
    <div class="warn">⭐ <b>根因</b> 与 <b>收获</b> 请务必由你本人写——AI 可起草问题 / 方案，但思考深度这部分才是面试的真正弹药。</div>
    <div class="field">
      <div class="lbl">根因 <span class="hint">为什么会出现——最有深度的一段</span><span class="count" id="c-root">0</span></div>
      <textarea id="rootCause" class="tall" placeholder="挖到本质：是对某个机制理解错了？还是设计层面有缺陷？">${v(entry?.rootCause)}</textarea>
    </div>
    <div class="field">
      <div class="lbl">方案 <span class="hint">你怎么做——具体步骤</span><span class="count" id="c-sol">0</span></div>
      <textarea id="solution" class="tall" placeholder="写清楚你的解决路径，可贴关键代码片段。">${v(entry?.solution)}</textarea>
    </div>
    <div class="field">
      <div class="lbl">收获 <span class="hint">学到了什么 / 以后怎么避</span><span class="count" id="c-lesson">0</span></div>
      <textarea id="lesson" class="tall" placeholder="把经验沉淀下来：能复用的判断 / 流程 / 原则。">${v(entry?.lesson)}</textarea>
    </div>
  </div>

  <h2>代码上下文</h2>
  <details class="ctx-wrap">
    <summary>查看已捕获的 diff / 选区</summary>
    <div class="ctx">${escapeHtml(ctxText)}</div>
  </details>

  <div class="actions">
    <button id="save" type="button">${isEdit ? '保存修改' : '保存到成长档案'}</button>
    <span class="sub" style="margin:0">Ctrl+Enter 提交</span>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    const get = (id) => $(id).value.trim();
    let draftStar = ${entry?.star ? JSON.stringify(entry.star) : 'null'};

    // 字数统计
    function bindCount(id, countId) {
      const el = $(id), c = $(countId);
      const update = () => { c.textContent = (el.value.length) + ' 字'; };
      el.addEventListener('input', update); update();
    }
    bindCount('rootCause', 'c-root');
    bindCount('solution', 'c-sol');
    bindCount('lesson', 'c-lesson');

    function submit() {
      if (!get('title')) {
        $('title').focus();
        $('title').style.borderColor = 'var(--accent)';
        return;
      }
      vscode.postMessage({
        type: 'submit',
        id: ${entry?.id ? `"${entry.id}"` : 'null'},
        title: get('title'),
        problem: get('problem'),
        rootCause: get('rootCause'),
        solution: get('solution'),
        lesson: get('lesson'),
        tags: get('tags'),
        star: draftStar
      });
    }
    $('save').addEventListener('click', submit);
    // Ctrl+Enter 提交
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    $('ai').addEventListener('click', () => {
      $('ai').textContent = '⏳ 起草中…';
      $('ai').disabled = true;
      vscode.postMessage({ type: 'draft' });
    });

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m && m.type === 'draftResult') {
        if (m.title) $('title').value = m.title;
        if (m.problem) $('problem').value = m.problem;
        if (m.rootCause) $('rootCause').value = m.rootCause;
        if (m.solution) $('solution').value = m.solution;
        if (m.lesson) $('lesson').value = m.lesson;
        if (m.tags && m.tags.length) $('tags').value = m.tags.join(', ');
        if (m.star && (m.star.situation || m.star.task || m.star.action || m.star.result)) {
          draftStar = m.star;
        }
        // 重新触发字数统计
        ['rootCause','solution','lesson'].forEach((id) => {
          const ev = new Event('input'); $(id).dispatchEvent(ev);
        });
        $('ai').textContent = '✨ AI 起草';
        $('ai').disabled = false;
      } else if (m && m.type === 'configNeeded') {
        $('ai').textContent = '✨ AI 起草';
        $('ai').disabled = false;
        vscode.postMessage({ type: 'configLLM' });
      }
    });
  </script>
</body>
</html>`;
}

export function detailHtml(e: Entry, webview: vscode.Webview): string {
  const nonce = getNonce();
  const ctx = e.context || {};
  const tags = (e.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const diffText = ctx.diff || '';
  const diffBlock = diffText
    ? `<div class="ctx">${escapeHtml(diffText.slice(0, 4000))}</div>`
    : '<div class="empty">无代码上下文</div>';
  const statusLabel: Record<string, string> = { done: '已完成', draft: '待补反思', 'pending-ai': '待 AI 起草' };
  const st = e.status || 'done';
  const star = e.star && (e.star.situation || e.star.task || e.star.action || e.star.result) ? e.star : null;
  const starBlock = star
    ? `<div class="star">
         <p><b>S</b>：${escapeHtml(star.situation || '')}</p>
         ${star.task ? `<p><b>T</b>：${escapeHtml(star.task)}</p>` : ''}
         <p><b>A</b>：${escapeHtml(star.action || '')}</p>
         <p><b>R</b>：${escapeHtml(star.result || '')}</p>
       </div>`
    : '<div class="empty">STAR 话术卡未生成。可由 WorkBuddy Skill 补全，或在下方「编辑」中手动补充。</div>';
  const banner = st !== 'done'
    ? `<div class="warn">⚠️ 这是 <b>${statusLabel[st] || st}</b> 状态。请点下方「编辑此记录」，确认并<b>补充根因与收获</b>后保存，使其变为正式面试弹药。</div>`
    : '';
  const fieldCard = (k: string, v: string, hint: string) => v.trim()
    ? `<div class="card"><div class="body"><span class="k">${k}</span>${escapeHtml(v)}</div></div>`
    : `<div class="card"><div class="body"><span class="k">${k}</span><span class="empty">${hint}</span></div></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(e.title || '未命名')}</h1>
    <span class="tag" style="font-weight:600">${statusLabel[st] || st}</span>
  </div>
  <div class="sub">${escapeHtml(e.createdAt || '')}　·　仓库：${escapeHtml(ctx.repo || '-')}　·　分支：${escapeHtml(ctx.branch || '-')}</div>
  ${tags ? `<div style="margin-bottom:14px">${tags}</div>` : ''}
  ${banner}

  <h2>反思框架</h2>
  <div class="group">
    ${fieldCard('问题', e.problem || '', '尚未填写')}
    ${fieldCard('根因', e.rootCause || '', '（待本人补充）')}
    ${fieldCard('方案', e.solution || '', '尚未填写')}
    ${fieldCard('收获', e.lesson || '', '（待本人补充）')}
  </div>

  <h2>STAR 话术卡</h2>
  ${starBlock}

  <h2>代码上下文</h2>
  ${diffBlock}

  <div class="actions">
    <button id="edit" type="button">✏️ 编辑此记录</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('edit').addEventListener('click', () => {
      vscode.postMessage({ type: 'edit' });
    });
  </script>
</body>
</html>`;
}
