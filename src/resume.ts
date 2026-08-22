import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Entry, getDbDir, loadEntries } from './store';
import { getLLMConfig, polishResume, polishProject, ProjectPolishRecord } from './llm';
import { runConfigureLLM } from './llm';
import { getNonce, WEBVIEW_STYLE, RESUME_STYLE } from './webview-common';

// 已选项目（聚合后的编辑态）
export interface ProjectBlock {
  id: string; // 聚合键：repo:<repo> 或 solo:<entryId>
  name: string;
  repo: string;
  time: string;
  intro: string;
  responsibilities: string[];
  achievements: string[];
  recordIds: string[];
}

// 选择器里的单条记录（init 数据，需携带原始字段供聚合提炼与 AI 润色）
interface InitEntry {
  id: string;
  title: string;
  date: string;
  repo: string;
  tags: string[];
  bullets: string[];
  hasStar: boolean;
  problem: string;
  solution: string;
  lesson: string;
  star: { situation: string; task: string; action: string; result: string };
}

// 从一条记录推导出"单条项目块"的默认要点（保留，作为回退）
export function defaultBullets(e: Entry): string[] {
  const out: string[] = [];
  const star = e.star && (e.star.action || e.star.result) ? e.star : null;
  if (star) {
    if (star.action) out.push(star.action);
    if (star.result) out.push(star.result);
  } else {
    if (e.solution) out.push(e.solution);
    if (e.lesson) out.push(e.lesson);
  }
  if (out.length === 0 && e.problem) out.push(e.problem);
  return out.slice(0, 4);
}

// 单条记录提炼一句核心要点（用于项目聚合：每条记录最多贡献 1 句，精炼）
function recordCoreBullet(e: Entry): string {
  const star = e.star && (e.star.action || e.star.result) ? e.star : null;
  let s = star ? (star.action || star.result) : (e.solution || e.lesson || e.problem || '');
  s = (s || '').trim();
  if (!s) return '';
  // 取首句
  s = s.split(/[。\n.!?！？]/)[0].trim();
  if (s.length > 46) s = s.slice(0, 46) + '…';
  s = s.replace(/[；;，,。.!?！？]+$/, '');
  return s;
}

function prettyRepo(r: string): string {
  let s = (r || '').trim().replace(/\.git$/, '');
  if (s.includes('/')) s = s.slice(s.lastIndexOf('/') + 1);
  return s || '未命名项目';
}

// 纯函数：把聚合后的项目装配成「项目经历」Markdown 段落（三段式：简介/本人负责/成果）
export function buildMarkdown(projects: ProjectBlock[]): string {
  if (!projects.length) return '';
  let out = '## 项目经历\n\n';
  for (const p of projects) {
    out += `### ${p.name || '未命名项目'}\n`;
    if (p.time && p.time.trim()) out += p.time.trim() + '\n';
    out += '\n';
    if (p.intro && p.intro.trim()) out += p.intro.trim() + '\n\n';
    if (p.responsibilities && p.responsibilities.length) {
      out += '**本人负责**\n';
      for (const b of p.responsibilities) {
        const bb = (b || '').trim();
        if (bb) out += `- ${bb}\n`;
      }
      out += '\n';
    }
    if (p.achievements && p.achievements.length) {
      out += '**成果**\n';
      for (const b of p.achievements) {
        const bb = (b || '').trim();
        if (bb) out += `- ${bb}\n`;
      }
      out += '\n';
    }
  }
  return out.trim() + '\n';
}

const STYLE = WEBVIEW_STYLE + RESUME_STYLE;



function resumeWebviewHtml(entries: InitEntry[], webview: vscode.Webview, aiEnabled: boolean): string {
  const nonce = getNonce();
  const data = JSON.stringify(entries);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${STYLE}</style>
</head>
<body>
  <h1>简历生成器 · 项目经历</h1>
  <div class="sub">勾选合适的成长记录 → 按「项目来源」自动聚合成项目经历块 → 调整措辞与简介 → 生成 Markdown。</div>

  <div class="hintbar">提示：已选记录会按<b>项目来源(repo) 自动聚合</b>成一个「项目经历」块——一个项目的多条记录会合并、提炼为精炼要点，避免堆砌。可编辑项目简介 / 本人负责 / 成果；配置 AI 模型后可<b>一键聚合润色</b>。</div>

  <h2>已选项目 · 按简历顺序</h2>
  <div id="list"></div>

  <div class="phead">
    <h2 style="margin:18px 0 6px">全部成长记录</h2>
    <div class="seg">
      <span class="seg-lbl">分组</span>
      <button class="seg-btn" data-grp="repo">按项目</button>
      <button class="seg-btn" data-grp="tag">按标签</button>
    </div>
  </div>
  <div id="picker"></div>

  <div class="actions">
    <button id="gen" type="button">📄 生成简历（项目经历）</button>
    <button id="copy" class="ghost" type="button" disabled>复制 Markdown</button>
    <button id="open" class="ghost" type="button" disabled>打开文件</button>
  </div>

  <h2>预览</h2>
  <div id="preview" class="preview"><div class="empty">尚未生成。勾选记录后点上方「生成」。</div></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const ENTRIES = ${data};
    const AI_ENABLED = ${aiEnabled ? 'true' : 'false'};
    let selected = [];                 // 已选记录 id（有序）
    let groupBy = 'repo';              // 选择器分组维度：repo | tag
    let projEdits = {};                // projectId -> {name?,time?,intro?,responsibilities?,achievements?}
    let projectOrder = [];             // 项目渲染顺序（projectId 列表）
    let lastMd = '';
    let lastPath = '';

    const byId = (id) => ENTRIES.find((e) => e.id === id);
    const esc = (s) => (s == null ? '' : String(s));

    function projectKey(e) {
      return (e.repo && e.repo.trim()) ? ('repo:' + e.repo.trim()) : ('solo:' + e.id);
    }
    function recordCoreBullet(e) {
      const star = (e.star && (e.star.action || e.star.result)) ? e.star : null;
      let s = star ? (star.action || star.result) : (e.solution || e.lesson || e.problem || '');
      s = (s || '').trim();
      if (!s) return '';
      s = s.split(/[。\\n.!?！？]/)[0].trim();
      if (s.length > 46) s = s.slice(0, 46) + '…';
      s = s.replace(/[；;，,。.!?！？]+$/, '');
      return s;
    }

    // 聚合：按项目来源把已选记录合成项目块
    function aggregate() {
      const groups = {};
      for (const id of selected) {
        const e = byId(id);
        if (!e) continue;
        const k = projectKey(e);
        (groups[k] = groups[k] || []).push(e);
      }
      const map = {};
      for (const k of Object.keys(groups)) {
        const recs = groups[k];
        const first = recs[0];
        const name = (first.repo && first.repo.trim()) ? prettyRepo(first.repo) : (first.title || '未命名项目');
        const dates = recs.map((r) => r.date).filter(Boolean).sort();
        const time = dates.length
          ? (dates[0] + (dates.length > 1 && dates[dates.length - 1] !== dates[0] ? ' - ' + dates[dates.length - 1] : ''))
          : '';
        const responsibilities = [];
        for (const r of recs) {
          const b = recordCoreBullet(r);
          if (b && responsibilities.indexOf(b) < 0) responsibilities.push(b);
        }
        map[k] = {
          id: k, name, repo: first.repo || '',
          time, intro: '', responsibilities, achievements: [],
          recordIds: recs.map((r) => r.id)
        };
      }
      // 按 projectOrder 排序，新项目追加到末尾
      const seen = {};
      const ordered = [];
      for (const k of projectOrder) {
        if (map[k]) { ordered.push(map[k]); seen[k] = 1; }
      }
      for (const k of Object.keys(map)) {
        if (!seen[k]) { ordered.push(map[k]); projectOrder.push(k); }
      }
      // 合并用户编辑
      for (const p of ordered) {
        const ed = projEdits[p.id];
        if (ed) {
          if (ed.name != null) p.name = ed.name;
          if (ed.time != null) p.time = ed.time;
          if (ed.intro != null) p.intro = ed.intro;
          if (ed.responsibilities != null) p.responsibilities = ed.responsibilities;
          if (ed.achievements != null) p.achievements = ed.achievements;
        }
      }
      return ordered;
    }

    function prettyRepo(r) {
      let s = (r || '').trim().replace(/\\.git$/, '');
      if (s.indexOf('/') >= 0) s = s.slice(s.lastIndexOf('/') + 1);
      return s || '未命名项目';
    }

    function getProjEdit(pid) {
      if (!projEdits[pid]) projEdits[pid] = {};
      return projEdits[pid];
    }

    function render() {
      const list = document.getElementById('list');
      const projects = aggregate();
      if (!ENTRIES.length) {
        list.innerHTML = '<div class="empty">还没有任何成长记录。先去「新增一条」或装 git 钩子采集。</div>';
        return;
      }
      if (projects.length === 0) {
        list.innerHTML = '<div class="empty">还没有选择任何记录。勾选下方任意记录的复选框开始。</div>';
        return;
      }
      let html = '';
      let n = 0;
      for (const p of projects) {
        n += 1;
        const respText = (p.responsibilities || []).join('\\n');
        const achText = (p.achievements || []).join('\\n');
        html += '<div class="proj" data-pid="' + p.id + '">';
        html += '  <div class="top">';
        html += '    <span class="pidx">' + n + '</span>';
        html += '    <input type="text" class="pname" data-pf="name" data-pid="' + p.id + '" value="' + esc(p.name) + '" style="font-weight:700">';
        html += '    <input type="text" class="ptime" data-pf="time" data-pid="' + p.id + '" value="' + esc(p.time) + '" placeholder="时间区间 如 2024.03 - 2024.06">';
        html += '    <button class="ghost" data-act="upProj" data-pid="' + p.id + '">↑</button>';
        html += '    <button class="ghost" data-act="downProj" data-pid="' + p.id + '">↓</button>';
        html += '    <button class="ghost" data-act="removeProj" data-pid="' + p.id + '">移除项目</button>';
        html += '  </div>';
        // 素材来源（折叠）
        html += '  <details class="src" open><summary>素材来源（' + p.recordIds.length + ' 条记录，可单独移除）</summary>';
        for (const rid of p.recordIds) {
          const re = byId(rid);
          html += '    <span class="ri">' + esc(re ? re.title : rid) +
                  ' <button class="ghost" data-act="unpick" data-id="' + rid + '">×</button></span>';
        }
        html += '  </details>';
        html += '  <div class="body">';
        html += '    <div class="field"><div class="lbl">项目简介（1-2 句：项目是什么、技术栈与规模）</div><textarea data-pf="intro" data-pid="' + p.id + '" placeholder="如：基于 Spring Cloud 的微服务招聘平台，前端 React+TS">' + esc(p.intro) + '</textarea></div>';
        html += '    <div class="field"><div class="lbl">本人负责（每条一行，建议 3-6 条，动词开头）</div><textarea data-pf="responsibilities" data-pid="' + p.id + '">' + esc(respText) + '</textarea></div>';
        html += '    <div class="field"><div class="lbl">成果（每条一行，尽量可量化；可留空）</div><textarea data-pf="achievements" data-pid="' + p.id + '">' + esc(achText) + '</textarea></div>';
        html += '    <div class="row">';
        if (AI_ENABLED) {
          html += '      <button class="ai" data-act="polishProj" data-pid="' + p.id + '">✨ AI 聚合润色</button>';
        }
        html += '    </div>';
        html += '    <div class="tip">一个项目只生成一块「项目经历」；勾选更多同项目记录会加入素材来源，点上方 ✨ 可重新聚合，或手动补充要点。</div>';
        html += '  </div>';
        html += '</div>';
      }
      list.innerHTML = html;
    }

    // 选择器（按项目/标签分组，可折叠）
    function categoryOf(e) {
      if (groupBy === 'tag') return (e.tags && e.tags[0]) ? e.tags[0] : '未分类';
      return (e.repo && e.repo.trim()) ? e.repo.trim() : '未分类';
    }
    function renderPicker() {
      if (!document.getElementById('picker')) {
        const h = document.createElement('div');
        h.id = 'picker';
        document.getElementById('list').after(h);
      }
      if (!ENTRIES.length) {
        document.getElementById('picker').innerHTML = '<div class="empty">还没有任何成长记录。</div>';
        return;
      }
      const groups = {};
      for (const e of ENTRIES) {
        const c = categoryOf(e);
        (groups[c] = groups[c] || []).push(e);
      }
      const keys = Object.keys(groups).sort((a, b) => {
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b, 'zh');
      });
      let html = '';
      for (const k of keys) {
        const list = groups[k];
        html += '<details class="grp" open><summary>'
             + '<span class="grp-ttl">' + esc(k) + '</span>'
             + '<span class="grp-n">' + list.length + '</span></summary>';
        for (const e of list) {
          const on = selected.indexOf(e.id) >= 0;
          html += '<div class="card" style="padding:8px 12px"><div class="top">'
               + '<input type="checkbox" data-act="toggle" data-id="' + e.id + '"' + (on ? ' checked' : '') + '>'
               + '<span class="ttl" data-act="toggle" data-id="' + e.id + '" style="cursor:pointer">' + esc(e.title) + '</span>'
               + '<span class="badge">' + esc(e.date) + (e.hasStar ? ' · 含STAR' : '') + '</span>'
               + '</div></div>';
        }
        html += '</details>';
      }
      document.getElementById('picker').innerHTML = html;
      document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-grp') === groupBy);
      });
    }

    document.body.addEventListener('click', (ev) => {
      const t = ev.target;
      const grp = t.getAttribute && t.getAttribute('data-grp');
      if (grp) { groupBy = grp; renderPicker(); return; }
      const act = t.getAttribute && t.getAttribute('data-act');
      if (!act) return;
      const id = t.getAttribute('data-id');
      const pid = t.getAttribute('data-pid');
      if (act === 'toggle') {
        if (selected.indexOf(id) >= 0) selected = selected.filter((x) => x !== id);
        else selected.push(id);
        render(); renderPicker();
      } else if (act === 'unpick') {
        selected = selected.filter((x) => x !== id);
        render(); renderPicker();
      } else if (act === 'removeProj') {
        const p = aggregate().find((x) => x.id === pid);
        if (p) selected = selected.filter((x) => p.recordIds.indexOf(x) < 0);
        projectOrder = projectOrder.filter((x) => x !== pid);
        delete projEdits[pid];
        render(); renderPicker();
      } else if (act === 'upProj' || act === 'downProj') {
        const i = projectOrder.indexOf(pid);
        const j = act === 'upProj' ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < projectOrder.length) {
          const tmp = projectOrder[i]; projectOrder[i] = projectOrder[j]; projectOrder[j] = tmp;
          render();
        }
      } else if (act === 'polishProj') {
        doPolishProject(pid);
      }
    });

    document.body.addEventListener('input', (ev) => {
      const t = ev.target;
      const f = t.getAttribute && t.getAttribute('data-pf');
      if (!f) return;
      const pid = t.getAttribute('data-pid');
      const ed = getProjEdit(pid);
      if (f === 'responsibilities' || f === 'achievements') {
        ed[f] = t.value.split('\\n').map((s) => s.trim());
      } else {
        ed[f] = t.value;
      }
    });

    function doPolishProject(pid) {
      const p = aggregate().find((x) => x.id === pid);
      if (!p) return;
      const records = p.recordIds.map((rid) => {
        const e = byId(rid);
        const star = (e && e.star) || {};
        return {
          title: e ? e.title : rid,
          tags: e ? (e.tags || []) : [],
          problem: e ? (e.problem || '') : '',
          solution: e ? (e.solution || '') : '',
          lesson: e ? (e.lesson || '') : '',
          star: { situation: star.situation || '', task: star.task || '', action: star.action || '', result: star.result || '' }
        };
      });
      const btn = document.querySelector('button[data-act="polishProj"][data-pid="' + pid + '"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 聚合中…'; }
      vscode.postMessage({
        type: 'polishProject',
        projectId: pid,
        name: p.name,
        time: p.time,
        intro: p.intro || '',
        responsibilities: p.responsibilities || [],
        records
      });
    }

    document.getElementById('gen').addEventListener('click', () => {
      if (selected.length === 0) {
        vscode.postMessage({ type: 'warn', msg: '请先勾选至少一条记录' });
        return;
      }
      const projects = aggregate().map((p) => ({
        id: p.id, name: p.name, repo: p.repo, time: p.time,
        intro: p.intro, responsibilities: p.responsibilities, achievements: p.achievements,
        recordIds: p.recordIds
      }));
      vscode.postMessage({ type: 'generate', projects });
    });

    document.getElementById('copy').addEventListener('click', () => {
      if (lastMd) vscode.postMessage({ type: 'copy', markdown: lastMd });
    });
    document.getElementById('open').addEventListener('click', () => {
      if (lastPath) vscode.postMessage({ type: 'openFile', path: lastPath });
    });

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (!m) return;
      if (m.type === 'generated') {
        lastMd = m.markdown || '';
        lastPath = m.path || '';
        document.getElementById('preview').innerHTML = lastMd ? renderPreview(lastMd) : '<div class="empty">生成内容为空。</div>';
        document.getElementById('copy').disabled = !lastMd;
        document.getElementById('open').disabled = !lastPath;
      } else if (m.type === 'polishProjectResult') {
        const pid = m.projectId;
        const ed = getProjEdit(pid);
        if (m.intro != null) ed.intro = m.intro;
        if (m.responsibilities) ed.responsibilities = m.responsibilities;
        if (m.achievements) ed.achievements = m.achievements;
        render();
        const btn = document.querySelector('button[data-act="polishProj"][data-pid="' + pid + '"]');
        if (btn) { btn.disabled = false; btn.textContent = '✨ AI 聚合润色'; }
      } else if (m.type === 'configNeeded') {
        const btn = document.querySelector('button[data-act="polishProj"]');
        if (btn) { btn.disabled = false; btn.textContent = '✨ AI 聚合润色'; }
        vscode.postMessage({ type: 'configLLM' });
      }
    });

    function renderPreview(md) {
      const escf = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const inline = (s) => s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      const lines = md.split('\\n');
      let h = '', inList = false;
      const close = () => { if (inList) { h += '</ul>'; inList = false; } };
      for (const line of lines) {
        const t = line.replace(/\\s+$/, '');
        if (/^### /.test(t)) { close(); h += '<h3>' + inline(escf(t.slice(4))) + '</h3>'; }
        else if (/^## /.test(t)) { close(); h += '<h2>' + inline(escf(t.slice(3))) + '</h2>'; }
        else if (/^- /.test(t)) { if (!inList){ h+='<ul>'; inList=true; } h += '<li>' + inline(escf(t.slice(2))) + '</li>'; }
        else if (t === '') { close(); }
        else { close(); h += '<p>' + inline(escf(t)) + '</p>'; }
      }
      close();
      return h;
    }

    render();
    renderPicker();
  </script>
</body>
</html>`;
}

export function showResumeBuilder(context: vscode.ExtensionContext): void {
  const entries = loadEntries();
  const init: InitEntry[] = entries.map((e) => ({
    id: e.id,
    title: e.title || '未命名记录',
    date: (e.createdAt || '').slice(0, 10),
    repo: (e.context && e.context.repo) || '',
    tags: e.tags || [],
    bullets: defaultBullets(e),
    hasStar: !!(e.star && (e.star.action || e.star.result)),
    problem: e.problem || '',
    solution: e.solution || '',
    lesson: e.lesson || '',
    star: e.star || { situation: '', task: '', action: '', result: '' },
  }));

  const panel = vscode.window.createWebviewPanel(
    'growthLogResume',
    '简历生成器',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  void (async () => {
    const cfg = await getLLMConfig(context);
    panel.webview.html = resumeWebviewHtml(init, panel.webview, !!cfg);
  })();

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'generate') {
      const projects: ProjectBlock[] = (msg.projects || []).map((p: any) => ({
        id: String(p.id || ''),
        name: String(p.name || ''),
        repo: String(p.repo || ''),
        time: String(p.time || ''),
        intro: String(p.intro || ''),
        responsibilities: Array.isArray(p.responsibilities) ? p.responsibilities.map((b: any) => String(b)) : [],
        achievements: Array.isArray(p.achievements) ? p.achievements.map((b: any) => String(b)) : [],
        recordIds: Array.isArray(p.recordIds) ? p.recordIds.map((x: any) => String(x)) : [],
      }));
      const md = buildMarkdown(projects);
      const dir = getDbDir();
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        /* ignore */
      }
      const filePath = path.join(dir, 'resume_projects.md');
      fs.writeFileSync(filePath, md, 'utf-8');
      panel.webview.postMessage({ type: 'generated', markdown: md, path: filePath });
    } else if (msg.type === 'copy') {
      try {
        await vscode.env.clipboard.writeText(String(msg.markdown || ''));
        vscode.window.showInformationMessage('✅ 已复制 Markdown 到剪贴板');
      } catch {
        vscode.window.showErrorMessage('复制失败');
      }
    } else if (msg.type === 'openFile') {
      const p = String(msg.path || '');
      if (p && fs.existsSync(p)) {
        const doc = await vscode.workspace.openTextDocument(p);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      }
    } else if (msg.type === 'warn') {
      vscode.window.showWarningMessage(String(msg.msg || ''));
    } else if (msg.type === 'configLLM') {
      await runConfigureLLM(context);
    } else if (msg.type === 'polish') {
      // 保留旧单条润色分支（极少触发，向后兼容）
      const cfg = await getLLMConfig(context);
      if (!cfg) {
        panel.webview.postMessage({ type: 'configNeeded' });
        return;
      }
      try {
        const res = await polishResume(cfg, {
          title: String(msg.title || ''),
          tags: Array.isArray(msg.tags) ? msg.tags.map((t: any) => String(t)) : [],
          problem: String(msg.problem || ''),
          solution: String(msg.solution || ''),
          lesson: String(msg.lesson || ''),
          star: msg.star || {},
        });
        panel.webview.postMessage({
          type: 'polishResult',
          id: msg.id,
          title: res.title,
          bullets: res.bullets,
        });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'configNeeded' });
        vscode.window.showErrorMessage('AI 润色失败：' + String(err?.message || err).slice(0, 200));
      }
    } else if (msg.type === 'polishProject') {
      const cfg = await getLLMConfig(context);
      if (!cfg) {
        panel.webview.postMessage({ type: 'configNeeded' });
        return;
      }
      try {
        const records: ProjectPolishRecord[] = (msg.records || []).map((r: any) => ({
          title: String(r.title || ''),
          tags: Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)) : [],
          problem: String(r.problem || ''),
          solution: String(r.solution || ''),
          lesson: String(r.lesson || ''),
          star: r.star || {},
        }));
        const res = await polishProject(cfg, {
          name: String(msg.name || ''),
          time: String(msg.time || ''),
          intro: String(msg.intro || ''),
          responsibilities: Array.isArray(msg.responsibilities) ? msg.responsibilities.map((b: any) => String(b)) : [],
          records,
        });
        panel.webview.postMessage({
          type: 'polishProjectResult',
          projectId: msg.projectId,
          intro: res.intro,
          responsibilities: res.responsibilities,
          achievements: res.achievements,
        });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'configNeeded' });
        vscode.window.showErrorMessage('AI 聚合润色失败：' + String(err?.message || err).slice(0, 200));
      }
    }
  });
}
