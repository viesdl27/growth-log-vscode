import * as vscode from 'vscode';
import {
  Entry,
  appendEntry,
  newId,
  updateEntry,
  loadEntries,
} from './store';
import { detectRepo, getDiff } from './git';
import { formHtml, detailHtml } from './webview';
import { getLLMConfig, draftFromContext, runConfigureLLM } from './llm';
import { refreshOutputs } from './render';

// 表单 / 详情面板共享的依赖：扩展上下文与树视图（用于保存后刷新）
export interface EntryViewDeps {
  context: vscode.ExtensionContext;
  treeProvider: { refresh(): void };
}

// 打开「记录 / 编辑」表单面板，处理提交与 AI 起草消息
export function openRecordForm(entry: Entry | undefined, deps: EntryViewDeps): void {
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
      const star =
        msg.star && (msg.star.situation || msg.star.task || msg.star.action || msg.star.result)
          ? {
              situation: String(msg.star.situation || ''),
              task: String(msg.star.task || ''),
              action: String(msg.star.action || ''),
              result: String(msg.star.result || ''),
            }
          : undefined;
      const patch = {
        title: msg.title || '未命名记录',
        problem: msg.problem || '',
        rootCause: msg.rootCause || '',
        solution: msg.solution || '',
        lesson: msg.lesson || '',
        tags,
        star,
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
      deps.treeProvider.refresh();
      refreshOutputs(deps.context);
      panel.dispose();
      // 编辑保存后，重新打开详情页显示更新后的内容
      if (isEdit && entry) {
        const updated = loadEntries().find((x) => x.id === entry.id);
        if (updated) {
          showDetail(updated, deps);
        }
      }
    } else if (msg && msg.type === 'draft') {
      const cfg = await getLLMConfig(deps.context);
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
    } else if (msg && msg.type === 'configLLM') {
      // 表单内点 AI 起草但未配置 → 直接打开配置向导
      runConfigureLLM(deps.context);
    }
  });
}

// 详情页单例：复用已打开的面板，避免每次点击都新开页面
let detailPanel: vscode.WebviewPanel | undefined;
let detailEntry: Entry | undefined;

export function showDetail(e: Entry, deps: EntryViewDeps): void {
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
      const target = detailEntry; // 先暂存，dispose 回调会清空 detailEntry
      panel.dispose(); // 先关闭详情页，避免保存后残留在旧内容
      openRecordForm(target, deps);
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
