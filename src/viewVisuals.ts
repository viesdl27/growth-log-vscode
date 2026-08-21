import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDbDir } from './store';
import { loadEntries } from './store';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
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
  const nonce = getNonce();
  const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

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
  <div class="sub">完整可视化（学习历程 / 检索 / 单项目时间线）在 Dashboard 中，保存记录或点「刷新」自动生成。</div>
  <div class="bar">
    <button id="refresh">刷新</button>
    <button id="open-dashboard">在浏览器打开 Dashboard</button>
    <span class="muted" style="font-size:12px">Dashboard：历程 + 检索 + 项目经历与单项目时间线</span>
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
    document.getElementById('open-dashboard').addEventListener('click', () => {
      vscode.postMessage({ type: 'openDashboard' });
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
    } else if (msg && msg.type === 'openDashboard') {
      const dashPath = path.join(getDbDir(), 'growth_dashboard.html');
      if (!fs.existsSync(dashPath)) {
        vscode.window.showErrorMessage(
          '未找到 growth_dashboard.html，先新增一条记录或点「刷新」生成它。'
        );
        return;
      }
      vscode.env.openExternal(vscode.Uri.file(dashPath));
    }
  });
}
