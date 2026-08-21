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
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
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
    --warn-bg: var(--vscode-inputValidation-warningBackground, var(--vscode-textCodeBlock-background));
    --warn-line: var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  }
  html { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         color: var(--fg); background: var(--bg); padding: 16px 20px; line-height: 1.6; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 14px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 14px 0 4px; }
  .hint { color: var(--muted); font-weight: 400; font-size: 12px; }
  input[type=text], textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--input-line);
         border-radius: 6px; padding: 8px 10px; font: inherit; background: var(--input-bg); color: var(--input-fg); }
  textarea { resize: vertical; min-height: 64px; }
  .ctx { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted);
         white-space: pre-wrap; max-height: 160px; overflow: auto; }
  .row { display: flex; gap: 10px; align-items: center; }
  .row > div { flex: 1; }
  .warn { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 6px;
          padding: 8px 12px; font-size: 12px; color: var(--fg); margin: 8px 0 2px; }
  .warn b { color: var(--accent); }
  button { background: var(--btn-bg); color: var(--btn-fg); border: 0; border-radius: 6px; padding: 9px 18px;
           font: inherit; font-weight: 600; cursor: pointer; margin-top: 18px; }
  button:hover { background: var(--btn-hover); }
  button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--input-line); }
  .tag { display: inline-block; background: var(--badge-bg); color: var(--badge-fg); border-radius: 999px;
         padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; }
  .k { font-weight: 600; color: var(--muted); width: 64px; display: inline-block; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 12px 0;
          background: var(--soft); }
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
    ? `仓库：${entry.context.repo || 'unknown'}${entry.context.branch ? '  分支：' + entry.context.branch : ''}\n${
        entry.context.diff
          ? '--- 已保存的代码上下文 ---\n' + entry.context.diff.slice(0, 4000)
          : ''
      }`
    : `仓库：${repo.repo || 'unknown'}${repo.branch ? '  分支：' + repo.branch : ''}\n${
        diff ? '--- 已捕获的代码上下文（提交时一并存入，可作参考）---\n' + diff.slice(0, 4000) : '（无选区/diff，可手动粘贴代码）'
      }`;

  const v = (s?: string) => escapeHtml(s || '');
  const heading = isEdit ? '编辑成长记录' : '记录这次成长';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
  <h1>${heading}</h1>
  <div class="sub">${
    isEdit
      ? '直接修改下方字段后保存即可更新该记录。'
      : '把「问题 / 根因 / 方案 / 收获」讲清楚——这是面试最能打动人的部分。'
  }</div>

  <div class="row">
    <button id="ai" class="ghost" type="button">✨ AI 起草</button>
    <span class="hint">（已配置 AI 模型时，自动根据上面的代码上下文起草全文）</span>
  </div>

  <label>标题</label>
  <input type="text" id="title" placeholder="一句话概括，如：用 Lombok 消除实体类样板代码" value="${v(entry?.title)}" />

  <label>问题 <span class="hint">（遇到了什么）</span></label>
  <textarea id="problem" placeholder="描述你解决的问题 / 现象">${v(entry?.problem)}</textarea>

  <div class="warn">⭐ <b>根因</b> 与 <b>收获</b> 这两段由<b>你本人</b>填写，最能体现思考深度。AI 可起草问题/方案，但根因与收获请你务必确认、补充成自己的话。</div>

  <label>根因 <span class="hint">（为什么会出现——最有思考深度的一段，请自己写）</span></label>
  <textarea id="rootCause" placeholder="根因是什么？">${v(entry?.rootCause)}</textarea>

  <label>方案 <span class="hint">（你怎么做）</span></label>
  <textarea id="solution" placeholder="你的解决方式">${v(entry?.solution)}</textarea>

  <label>收获 <span class="hint">（学到了什么 / 以后怎么避——请自己写）</span></label>
  <textarea id="lesson" placeholder="沉淀下来的经验">${v(entry?.lesson)}</textarea>

  <label>标签 <span class="hint">（逗号或空格分隔，如：重构, 代码质量, Java）</span></label>
  <input type="text" id="tags" placeholder="重构, 代码质量, Java" value="${v((entry?.tags || []).join(', '))}" />

  <label>代码上下文</label>
  <div class="ctx">${escapeHtml(ctxText)}</div>

  <button id="save">${isEdit ? '保存修改' : '保存到成长档案'}</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    const get = (id) => $(id).value.trim();

    $('save').addEventListener('click', () => {
      if (!get('title')) { alert('请先填写标题'); return; }
      vscode.postMessage({
        type: 'submit',
        id: ${entry?.id ? `"${entry.id}"` : 'null'},
        title: get('title'),
        problem: get('problem'),
        rootCause: get('rootCause'),
        solution: get('solution'),
        lesson: get('lesson'),
        tags: get('tags')
      });
    });

    $('ai').addEventListener('click', () => {
      $('ai').textContent = '⏳ 起草中…';
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
        $('ai').textContent = '✨ AI 起草';
      } else if (m && m.type === 'configNeeded') {
        alert('尚未配置 AI 模型。请运行命令：成长记录：配置 AI 模型');
        $('ai').textContent = '✨ AI 起草';
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
  const diffBlock = ctx.diff
    ? `<div class="ctx">${escapeHtml(ctx.diff.slice(0, 4000))}</div>`
    : '<div class="ctx">（无代码上下文）</div>';
  const star = e.star && (e.star.situation || e.star.task || e.star.action || e.star.result)
    ? `<div class="card">
         <div><span class="k">S</span>${escapeHtml(e.star.situation || '')}</div>
         <div><span class="k">T</span>${escapeHtml(e.star.task || '')}</div>
         <div><span class="k">A</span>${escapeHtml(e.star.action || '')}</div>
         <div><span class="k">R</span>${escapeHtml(e.star.result || '')}</div>
       </div>`
    : '<div class="sub">（STAR 话术卡可由 WorkBuddy Skill 生成，或在此页点「编辑此记录」直接在 VS 内补充）</div>';
  const needed = e.status === 'pending-ai' || e.status === 'draft';
  const banner = needed
    ? `<div class="warn">⚠️ 这是 AI 起草的草稿（或待起草）。请点下方「编辑此记录」，确认并<b>补充根因与收获</b>后保存，使其变为正式弹药。</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
  <h1>${escapeHtml(e.title)}</h1>
  <div class="sub">${escapeHtml(e.createdAt)}  ·  仓库：${escapeHtml(ctx.repo || '-')}  ·  分支：${escapeHtml(ctx.branch || '-')}</div>
  ${banner}
  <div>${tags}</div>

  <div class="card"><div><span class="k">问题</span>${escapeHtml(e.problem || '')}</div></div>
  <div class="card"><div><span class="k">根因</span>${escapeHtml(e.rootCause || '')}</div></div>
  <div class="card"><div><span class="k">方案</span>${escapeHtml(e.solution || '')}</div></div>
  <div class="card"><div><span class="k">收获</span>${escapeHtml(e.lesson || '')}</div></div>

  <label>STAR 话术卡</label>
  ${star}

  <label>代码上下文</label>
  ${diffBlock}

  <button id="edit" type="button">✏️ 编辑此记录</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('edit').addEventListener('click', () => {
      vscode.postMessage({ type: 'edit' });
    });
  </script>
</body>
</html>`;
}
