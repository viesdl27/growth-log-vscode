import * as vscode from 'vscode';
import {
  loadEntries,
  getDbDir,
  getDbFile,
  updateEntry,
  deleteEntry,
} from './store';
import { GrowthTreeProvider } from './tree';
import { openRecordForm, showDetail } from './entryView';
import { showResumeBuilder } from './resume';
import { showVisuals } from './viewVisuals';
import { getLLMConfig, draftFromContext, runConfigureLLM } from './llm';
import { installHook, uninstallHook, healHook } from './hooks';
import { setGroupingCmd, filterCmd, searchCmd } from './browse';
import { refreshOutputs } from './render';

let treeProvider: GrowthTreeProvider;
let extContext: vscode.ExtensionContext;

// 已在起草中的条目，避免文件监听重复触发
const drafting = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  treeProvider = new GrowthTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('growth-log.entries', treeProvider)
  );

  const deps = { context, treeProvider };

  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.record', () => openRecordForm(undefined, deps))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.editEntry', (e: any) => openRecordForm(e, deps))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.openFolder', () => {
      vscode.env.openExternal(vscode.Uri.file(getDbDir()));
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.refresh', () => treeProvider.refresh())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.openDetail', (e: any) => showDetail(e, deps))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.deleteEntry', (e: any) => deleteEntryCmd(e))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.installHook', () => installHook(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.uninstallHook', () => uninstallHook())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.setGrouping', () => setGroupingCmd(treeProvider))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.filter', () => filterCmd(treeProvider))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.search', () => searchCmd(treeProvider))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.viewVisuals', () => showVisuals())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.configureLLM', () => runConfigureLLM(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('growth-log.generateResume', () => showResumeBuilder(context))
  );

  // 监听本地库变化（如 git 钩子写入、Skill 侧编辑），自动刷新侧边栏
  const watcher = vscode.workspace.createFileSystemWatcher(getDbFile());
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
  // 激活时自愈：修复指向失效路径的提交钩子（扩展升级/卸载导致）
  healHook(context);
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
        star: d.star,
        status: 'draft',
      });
      treeProvider.refresh();
      refreshOutputs(extContext);
      const act = await vscode.window.showInformationMessage(
        `🤖 AI 已为「${d.title || e.title}」起草完成，请在侧边栏点开补充/确认根因与收获`,
        '去补充'
      );
      if (act === '去补充') {
        openRecordForm(e, { context: extContext, treeProvider });
      }
    } catch (err: any) {
      vscode.window.showWarningMessage('AI 自动起草失败：' + String(err?.message || err).slice(0, 200));
    } finally {
      drafting.delete(e.id);
    }
  }
}

async function deleteEntryCmd(e: any): Promise<void> {
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

export function deactivate(): void {
  // no-op
}
