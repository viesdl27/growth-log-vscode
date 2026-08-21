import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DB_DIR } from './store';
import { loadEntries } from './store';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function readSvg(name: string): { ok: boolean; content: string; mtime: string } {
  const p = path.join(DB_DIR, name);
  if (!fs.existsSync(p)) {
    return { ok: false, content: '', mtime: '' };
  }
  const raw = fs.readFileSync(p, 'utf-8');
  // 主题化处理：把深色的文字填充替换为 currentColor，跟随 VS Code 主题前景色，
  // 这样在暗色主题下也能看清（SVG 本身透明背景，会自动透出主题底色）。
  const themed = raw
    .replace(/#24292f/g, 'currentColor')
    .replace(/#444441/g, 'currentColor')
    .replace(/#656d76/g, 'currentColor');
  return { ok: true, content: themed, mtime: fs.statSync(p).mtime.toLocaleString() };
}

function recordsListHtml(): string {
  const entries = loadEntries();
  if (!entries.length) {
    return '<p class="muted">暂无记录，先用「记录这次成长」或提交代码自动抓取。</p>';
  }
  const rows = entries
    .slice()
    .reverse()
    .map((e) => {
      const tags = (e.tags || [])
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join('');
      const statusMap: Record<string, string> = {
        'pending-ai': '待AI起草',
        draft: '待补反思',
        done: '已完成',
      };
      const st = statusMap[e.status || 'done'] || e.status || '';
      return `<li><span class="date">${escapeHtml(e.createdAt || '')}</span>
        <span class="title">${escapeHtml(e.title || '未命名')}</span>
        <span class="status">${escapeHtml(st)}</span><div class="tags">${tags}</div></li>`;
    })
    .join('');
  return `<ul class="rec">${rows}</ul>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHtml(webview: vscode.Webview): string {
  const radar = readSvg('growth_radar.svg');
  const timeline = readSvg('growth_timeline.svg');
  const nonce = getNonce();
  const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  const radarBlock = radar.ok
    ? `<div class="fig">${radar.content}<p class="cap">能力雷达 · 更新于 ${radar.mtime}</p></div>`
    : `<div class="empty">未找到 growth_radar.svg。<br/>在 WorkBuddy 对话中说「刷新成长产出」即可生成。</div>`;
  const timelineBlock = timeline.ok
    ? `<div class="fig">${timeline.content}<p class="cap">成长时间线 · 更新于 ${timeline.mtime}</p></div>`
    : `<div class="empty">未找到 growth_timeline.svg。<br/>在 WorkBuddy 对话中说「刷新成长产出」即可生成。</div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    margin: 0; padding: 18px 22px 40px;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 14px; }
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .section { margin: 18px 0; }
  .section h2 { font-size: 14px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; margin: 0 0 10px; }
  .fig { background: var(--vscode-editor-background); }
  .fig svg { width: 100%; height: auto; max-width: 720px; display: block; color: var(--vscode-foreground); }
  .cap { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 4px 0 0; }
  .empty {
    border: 1px dashed var(--vscode-panel-border); border-radius: 8px; padding: 18px;
    color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1.7;
  }
  .muted { color: var(--vscode-descriptionForeground); font-size: 13px; }
  ul.rec { list-style: none; padding: 0; margin: 0; }
  ul.rec li {
    border-bottom: 1px solid var(--vscode-panel-border); padding: 9px 0;
  }
  ul.rec .date { color: var(--vscode-descriptionForeground); font-size: 12px; margin-right: 10px; }
  ul.rec .title { font-weight: 600; }
  ul.rec .status {
    float: right; font-size: 11px; color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background); border-radius: 999px; padding: 1px 9px;
  }
  .tags { margin-top: 5px; }
  .tag {
    display: inline-block; font-size: 11px; margin: 2px 5px 0 0; padding: 1px 9px;
    border-radius: 999px; color: var(--vscode-textLink-foreground);
    background: var(--vscode-textCodeBlock-background);
  }
</style>
</head>
<body>
  <h1>成长可视化</h1>
  <div class="sub">雷达图与时间线由 Skill 侧 render.py 生成。刷新：在 WorkBuddy 对话中说「刷新成长产出」。</div>
  <div class="bar">
    <button id="refresh">刷新</button>
    <span class="muted" style="font-size:12px">重新读取本地档案</span>
  </div>

  <div class="section">
    <h2>能力雷达</h2>
    ${radarBlock}
  </div>
  <div class="section">
    <h2>成长时间线</h2>
    ${timelineBlock}
  </div>
  <div class="section">
    <h2>记录清单</h2>
    ${recordsListHtml()}
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
  </script>
</body>
</html>`;
}

export function showVisuals(): void {
  const panel = vscode.window.createWebviewPanel(
    'growthLogVisuals',
    '成长可视化',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );
  panel.webview.html = buildHtml(panel.webview);
  panel.webview.onDidReceiveMessage((msg: any) => {
    if (msg && msg.type === 'refresh') {
      panel.webview.html = buildHtml(panel.webview);
    }
  });
}
