import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendEntry,
  newId,
  deleteEntry,
  updateEntry,
  Entry,
  loadEntries,
  DB_FILE,
  DB_DIR,
} from './store';
import { detectRepo, getDiff, getRepoRoot } from './git';
import { GrowthTreeProvider } from './tree';
import { formHtml, detailHtml } from './webview';
import { showVisuals } from './viewVisuals';
import { getLLMConfig, draftFromContext, runConfigureLLM } from './llm';

let treeProvider: GrowthTreeProvider;
let extContext: vscode.ExtensionContext;

// WorkBuddy 受管 node 作为钩子兜底（当 PATH 中无 node 时使用）
const FALLBACK_NODE = 'C:/Users/29414/.workbuddy/binaries/node/versions/22.22.2/node.exe';

// 已在起草中的条目，避免文件监听重复触发
const drafting = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  treeProvider = new GrowthTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('growth-log.entries', treeProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.record', () => recordEntry())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.editEntry', (e: Entry) => recordEntry(e))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.openFolder', () => {
      vscode.env.openExternal(vscode.Uri.file(DB_DIR));
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.refresh', () => treeProvider.refresh())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.openDetail', (e: Entry) => showDetail(e))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.deleteEntry', (e: Entry) => deleteEntryCmd(e))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.installHook', () => installHook(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.uninstallHook', () => uninstallHook())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.setGrouping', () => setGroupingCmd())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.filter', () => filterCmd())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.viewVisuals', () => showVisuals())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.configureLLM', () => runConfigureLLM(context))
  );

  // 监听本地库变化（如 git 钩子写入、Skill 侧编辑），自动刷新侧边栏
  const watcher = vscode.workspace.createFileSystemWatcher(DB_FILE);
  watcher.onDidChange(() => {
    treeProvider.refresh();
    autoDraftPending();
  });
  watcher.onDidCreate(() => {
    treeProvider.refresh();
    autoDraftPending();
  });
  context.subscriptions.push(watcher);

  // 激活时扫描：补齐 VS Code 关闭期间产生的待起草条目
  autoDraftPending();
}

function recordEntry(entry?: Entry): void {
  const isEdit = !!entry;
  const repo = entry?.context
    ? { repo: entry.context.repo || '', branch: entry.context.branch || '' }
    : detectRepo();
  const diff = entry?.context?.diff || getDiff();
  const panel = vscode.window.createWebviewPanel(
    'growthLogForm',
    isEdit ? '编辑成长记录' : '记录这次成长',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = formHtml(repo, diff, panel.webview, entry);

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    if (msg && msg.type === 'submit') {
      const tags = String(msg.tags || '')
        .split(/[,，\s]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);
      const patch = {
        title: msg.title || '未命名记录',
        problem: msg.problem || '',
        rootCause: msg.rootCause || '',
        solution: msg.solution || '',
        lesson: msg.lesson || '',
        tags,
        status: 'done' as string,
      };
      if (isEdit && entry) {
        updateEntry(entry.id, patch);
        vscode.window.showInformationMessage('✅ 已更新记录');
      } else {
        const newEntry: Entry = {
          id: newId(),
          createdAt: new Date().toISOString().slice(0, 10),
          context: {
            repo: repo.repo,
            branch: repo.branch,
            files: [],
            diff: diff.slice(0, 8000),
            commit: null,
          },
          ...patch,
        };
        appendEntry(newEntry);
        vscode.window.showInformationMessage('✅ 已记录到成长档案');
      }
      treeProvider.refresh();
      refreshOutputs();
      panel.dispose();
      // 编辑保存后，重新打开详情页显示更新后的内容
      if (isEdit && entry) {
        const updated = loadEntries().find((x) => x.id === entry.id);
        if (updated) {
          showDetail(updated);
        }
      }
    } else if (msg && msg.type === 'draft') {
      const cfg = await getLLMConfig(extContext);
      if (!cfg) {
        panel.webview.postMessage({ type: 'configNeeded' });
        return;
      }
      try {
        const d = await draftFromContext(cfg, {
          repo: repo.repo || 'unknown',
          branch: repo.branch || '',
          files: entry?.context?.files || [],
          diff: diff || '',
          commit: entry?.context?.commit || undefined,
        });
        panel.webview.postMessage({ type: 'draftResult', ...d });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'configNeeded' });
        vscode.window.showErrorMessage('AI 起草失败：' + String(err?.message || err).slice(0, 200));
      }
    }
  });
}

// 详情页单例：复用已打开的面板，避免每次点击都新开页面
let detailPanel: vscode.WebviewPanel | undefined;
let detailEntry: Entry | undefined;

function showDetail(e: Entry): void {
  // 已有打开的详情页：直接复用，切换内容并聚焦
  if (detailPanel) {
    detailEntry = e;
    detailPanel.title = e.title;
    detailPanel.webview.html = detailHtml(e, detailPanel.webview);
    detailPanel.reveal();
    return;
  }
  detailPanel = vscode.window.createWebviewPanel(
    'growthLogDetail',
    e.title,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  detailEntry = e;
  const panel = detailPanel;
  panel.webview.html = detailHtml(e, panel.webview);
  panel.webview.onDidReceiveMessage((msg: any) => {
    if (msg && msg.type === 'edit' && detailEntry) {
      const target = detailEntry;   // 先暂存，dispose 回调会清空 detailEntry
      panel.dispose();   // 先关闭详情页，避免保存后残留在旧内容
      recordEntry(target);
    }
  });
  panel.onDidDispose(() => {
    // 面板关闭后清空单例，下次点击重新创建
    if (detailPanel === panel) {
      detailPanel = undefined;
      detailEntry = undefined;
    }
  });
}

// 扫描待起草条目，配置好 AI 模型时自动起草（提交即全自动起草的核心）
async function autoDraftPending(): Promise<void> {
  const cfg = await getLLMConfig(extContext);
  if (!cfg) {
    return;
  }
  const entries = loadEntries();
  for (const e of entries) {
    if (e.status !== 'pending-ai') {
      continue;
    }
    if (drafting.has(e.id)) {
      continue;
    }
    drafting.add(e.id);
    try {
      const d = await draftFromContext(cfg, {
        repo: e.context?.repo || 'unknown',
        branch: e.context?.branch || '',
        files: e.context?.files || [],
        diff: e.context?.diff || '',
        commit: e.context?.commit || undefined,
      });
      updateEntry(e.id, {
        title: d.title || e.title,
        problem: d.problem || '',
        rootCause: d.rootCause || '',
        solution: d.solution || '',
        lesson: d.lesson || '',
        tags: d.tags && d.tags.length ? d.tags : e.tags,
        status: 'draft',
      });
      treeProvider.refresh();
      refreshOutputs();
      const act = await vscode.window.showInformationMessage(
        `🤖 AI 已为「${d.title || e.title}」起草完成，请在侧边栏点开补充/确认根因与收获`,
        '去补充'
      );
      if (act === '去补充') {
        recordEntry(e);
      }
    } catch (err: any) {
      vscode.window.showWarningMessage('AI 自动起草失败：' + String(err?.message || err).slice(0, 200));
    } finally {
      drafting.delete(e.id);
    }
  }
}

async function deleteEntryCmd(e: Entry): Promise<void> {
  const ok = await vscode.window.showWarningMessage(
    `确定删除「${e.title}」？此操作不可撤销。`,
    { modal: true },
    '删除'
  );
  if (ok === '删除') {
    deleteEntry(e.id);
    treeProvider.refresh();
    vscode.window.showInformationMessage('已删除该记录');
  }
}

async function installHook(context: vscode.ExtensionContext): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage('当前工作区不是 git 仓库，无法安装提交钩子');
    return;
  }
  const hookDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hookDir, 'post-commit');
  const scriptPath = path
    .join(context.extensionPath, 'scripts', 'capture.js')
    .replace(/\\/g, '/');

  const hookBody = [
    '#!/bin/sh',
    '# 由「成长记录」扩展自动安装：提交后自动抓取上下文写入成长档案库',
    'NODE_BIN="node"',
    'if ! command -v node >/dev/null 2>&1; then',
    `  NODE_BIN="${FALLBACK_NODE}"`,
    'fi',
    `SCRIPT="${scriptPath}"`,
    'ROOT="$(git rev-parse --show-toplevel)"',
    'if [ -f "$SCRIPT" ]; then',
    '  "$NODE_BIN" "$SCRIPT" "$ROOT" >> "$HOME/.workbuddy/growth-log/hook.log" 2>&1',
    'fi',
    ''
  ].join('\n');

  try {
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(hookPath, hookBody, { mode: 0o755 });
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {
      // Windows 上 +x 并非必需，Git 按文件名执行
    }
    vscode.window.showInformationMessage(
      '✅ 已安装提交钩子，此后每次 git commit 会自动抓取上下文（若已配置 AI 模型，将自动起草）'
    );
  } catch (err) {
    vscode.window.showErrorMessage('安装提交钩子失败：' + String(err));
  }
}

async function uninstallHook(): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage('当前工作区不是 git 仓库');
    return;
  }
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'post-commit');
  if (fs.existsSync(hookPath)) {
    try {
      fs.unlinkSync(hookPath);
      vscode.window.showInformationMessage('已卸载提交钩子');
    } catch (err) {
      vscode.window.showErrorMessage('卸载失败：' + String(err));
    }
  } else {
    vscode.window.showInformationMessage('未发现提交钩子，无需卸载');
  }
}

async function setGroupingCmd(): Promise<void> {
  const picks: { label: string; value: 'project' | 'time' | 'tag' }[] = [
    { label: '按项目（默认）', value: 'project' },
    { label: '按时间', value: 'time' },
    { label: '按标签', value: 'tag' },
  ];
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: '选择分组方式（整理档案）',
  });
  if (pick) {
    treeProvider.setGrouping(pick.value);
    vscode.window.showInformationMessage(`已按${pick.label.replace('（默认）', '')}分组`);
  }
}

async function filterCmd(): Promise<void> {
  const entries = loadEntries();
  const repos = [...new Set(entries.map((e) => e.context?.repo || '未知仓库'))];
  const tags = [...new Set(entries.flatMap((e) => e.tags || []))];
  const picks: {
    label: string;
    filter: { type: 'repo' | 'tag'; value: string } | null;
  }[] = [];
  for (const r of repos) {
    picks.push({ label: `项目 ▸ ${r}`, filter: { type: 'repo', value: r } });
  }
  for (const t of tags) {
    picks.push({ label: `标签 ▸ ${t}`, filter: { type: 'tag', value: t } });
  }
  picks.push({ label: '✕ 清除筛选', filter: null });
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: '按项目或标签筛选（整理档案）',
  });
  if (pick) {
    const f = pick.filter;
    treeProvider.setFilter(f);
    if (f) {
      vscode.window.showInformationMessage(
        `已筛选：${f.type === 'repo' ? '项目' : '标签'} = ${f.value}`
      );
    } else {
      vscode.window.showInformationMessage('已清除筛选');
    }
  }
}

// 存完即调用 Skill 的 render.py 刷新 SVG/STAR（非阻塞，失败忽略）
function refreshOutputs(): void {
  const script = path.join(
    os.homedir(),
    '.workbuddy',
    'skills',
    'growth-log',
    'scripts',
    'render.py'
  );
  let py = 'python3';
  if (process.platform === 'win32') {
    py = 'python';
  }
  try {
    const child = spawn(py, [script], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // 忽略：用户可手动在 Skill 侧重新生成
  }
}

export function deactivate(): void {
  // no-op
}
