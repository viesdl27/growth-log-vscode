import * as vscode from 'vscode';
import { loadEntries } from './store';
import { GrowthTreeProvider } from './tree';

// 切换侧边栏分组方式：按项目 / 按时间 / 按标签
export async function setGroupingCmd(treeProvider: GrowthTreeProvider): Promise<void> {
  const picks: { label: string; value: 'project' | 'time' | 'tag' }[] = [
    { label: '按项目', value: 'project' },
    { label: '按时间', value: 'time' },
    { label: '按标签', value: 'tag' },
  ];
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: '选择侧边栏的分组方式',
  });
  if (pick) {
    treeProvider.setGrouping(pick.value);
    vscode.window.showInformationMessage(`已切换为${pick.label}分组`);
  }
}

// 按项目或标签筛选侧边栏记录
export async function filterCmd(treeProvider: GrowthTreeProvider): Promise<void> {
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

// 按关键词搜索侧边栏记录
export async function searchCmd(treeProvider: GrowthTreeProvider): Promise<void> {
  const prev = treeProvider.search;
  const input = await vscode.window.showInputBox({
    prompt: '按关键词过滤侧边栏记录（标题 / 问题 / 方案 / 收获 / 标签），留空清除',
    value: prev,
    placeHolder: '如：钩子、Spring、性能',
  });
  if (input === undefined) return; // 用户取消
  treeProvider.setSearch(input);
  if (input.trim()) {
    vscode.window.showInformationMessage(`已按关键词搜索：「${input.trim()}」`);
  } else {
    vscode.window.showInformationMessage('已清除搜索');
  }
}
