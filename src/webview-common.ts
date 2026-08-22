// Webview 公共工具：消除各模块里重复的 nonce / 转义 / 样式定义。
// 表单页、详情页、简历页、可视化页统一从这里取，避免散落多处、改一处漏一处。

/** 生成 32 位随机 nonce，供 CSP 的 script-src 使用。 */
export function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/** HTML 转义（覆盖 & < > " '，足以用于文本与属性插值的防注入）。 */
export function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 表单页 / 详情页共用的样式（含主题变量、字段、卡片、按钮、STAR 卡、代码上下文块）。 */
export const WEBVIEW_STYLE = `
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

/** 简历生成器页专属样式（在通用样式基础上追加：项目块、选择器、预览、分段切换等）。 */
export const RESUME_STYLE = `
  .card .top { display: flex; align-items: center; gap: 8px; }
  .card .top input[type=checkbox] { width: 16px; height: 16px; flex: 0 0 auto; }
  .card .ttl { font-weight: 600; font-size: 13px; cursor: pointer; }
  .card .badge { font-size: 11px; color: var(--muted); }
  .field .lbl { font-size: 11px; color: var(--muted); margin: 0 0 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .idx { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px;
         border-radius: 999px; background: var(--badge-bg); color: var(--badge-fg); font-size: 11px; font-weight: 600; }
  button:disabled { opacity: .5; cursor: default; }
  .preview { border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; background: var(--bg); }
  .preview h2 { color: var(--fg); text-transform: none; letter-spacing: 0; font-size: 16px; }
  .preview h3 { font-size: 14px; margin: 14px 0 4px; }
  .preview ul { margin: 4px 0; padding-left: 20px; }
  .preview li { margin: 3px 0; }
  .preview p { margin: 4px 0; }
  .hintbar { background: var(--soft); border-left: 3px solid var(--accent); padding: 8px 12px; font-size: 12px; margin: 0 0 12px; border-radius: 4px; }
  .phead { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .seg { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 10px; }
  .seg-lbl { font-size: 11px; color: var(--muted); }
  .seg-btn { background: transparent; color: var(--muted); border: 1px solid var(--input-line); border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .seg-btn:hover { color: var(--fg); }
  .seg-btn.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .grp { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin: 0 0 10px; background: var(--bg); }
  .grp > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 13px; font-weight: 600; }
  .grp > summary::-webkit-details-marker { display: none; }
  .grp > summary::before { content: '▸'; color: var(--muted); transition: transform .12s; }
  .grp[open] > summary::before { content: '▾'; }
  .grp-ttl { flex: 0 0 auto; }
  .grp-n { font-size: 11px; color: var(--muted); background: var(--soft); border-radius: 999px; padding: 1px 8px; }
  .grp .card { margin: 8px 0 0; }
  .proj { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 0 0 12px; background: var(--bg); }
  .proj .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .proj .pidx { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px;
               border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; }
  .proj .pname { font-weight: 700; font-size: 14px; flex: 1 1 auto; min-width: 160px; }
  .proj .ptime { font-size: 12px; color: var(--muted); min-width: 160px; }
  .proj .body { margin-top: 10px; }
  .proj .src { font-size: 12px; color: var(--muted); margin: 2px 0 8px; }
  .proj .src .ri { display: inline-flex; align-items: center; gap: 4px; margin: 2px 6px 2px 0;
                   border: 1px solid var(--line); border-radius: 999px; padding: 1px 4px 1px 8px; }
  .proj .src .ri button { padding: 0 6px; font-size: 11px; border-radius: 999px; }
  .tip { font-size: 11px; color: var(--muted); margin: 6px 0 0; }
`;
