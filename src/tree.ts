import * as vscode from 'vscode';
import * as fs from 'fs';
import { loadEntries, Entry, getDbFile } from './store';

export type Grouping = 'time' | 'project' | 'tag';

export interface GroupNode {
  __group: true;
  kind: 'repo' | 'tag' | 'month';
  key: string;
  label: string;
  count: number;
  // 二级月份节点需要记住父分组，展开月份时按父分组过滤
  parent?: { kind: 'repo' | 'tag'; key: string };
}

export type TreeNode = Entry | GroupNode;

// 分组内条数超过该阈值时，按月份二级折叠，避免一次性渲染大量节点
const GROUP_MONTH_THRESHOLD = 40;

// 内存缓存：按 DB_FILE 的 mtime 失效，树刷新不再反复读盘
let cache: { mtime: number; entries: Entry[] } | null = null;

function cachedEntries(): Entry[] {
  let mtime = 0;
  try {
    mtime = fs.statSync(getDbFile()).mtimeMs;
  } catch {
    /* 文件不存在时走全量读取 */
  }
  if (!cache || cache.mtime !== mtime) {
    cache = { mtime, entries: loadEntries() };
  }
  return cache.entries;
}

function monthOf(e: Entry): string {
  return (e.createdAt || '').slice(0, 7);
}

export class GrowthTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  grouping: Grouping = 'project';
  // 筛选：只看某个项目或某个标签；null 表示不过滤
  filter: { type: 'repo' | 'tag'; value: string } | null = null;
  // 关键词搜索：匹配标题/问题/方案/收获/标签；空串表示不过滤
  search = '';

  setGrouping(g: Grouping): void {
    this.grouping = g;
    this.refresh();
  }

  setFilter(f: { type: 'repo' | 'tag'; value: string } | null): void {
    this.filter = f;
    this.refresh();
  }

  setSearch(s: string): void {
    this.search = (s || '').trim();
    this.refresh();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (isGroup(node)) {
      const label =
        node.kind === 'repo'
          ? '项目 · ' + node.label
          : node.kind === 'tag'
          ? '标签 · ' + node.label
          : node.label; // month
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${node.count} 条`;
      item.iconPath = new vscode.ThemeIcon(
        node.kind === 'month' ? 'calendar' : 'folder'
      );
      return item;
    }
    const e = node as Entry;
    const item = new vscode.TreeItem(e.title, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'growth-log-entry';
    const statusMap: Record<string, { label: string; icon: string; color?: string }> = {
      'pending-ai': { label: '· 待 AI 起草', icon: 'clock', color: 'descriptionForeground' },
      draft: { label: '· 待补反思', icon: 'edit', color: 'editorWarning.foreground' },
      done: { label: '', icon: 'check' },
    };
    const s = statusMap[e.status || 'done'] || statusMap.done;
    const desc = (s.label ? s.label + '  ' : '') + (e.createdAt || '');
    item.description = desc;
    if (e.status) item.iconPath = new vscode.ThemeIcon(s.icon);
    item.tooltip = (e.tags || []).join(' · ') || s.label.replace(/^·\s*/, '') || e.title;
    item.command = {
      command: 'growth-log.openDetail',
      title: '查看',
      arguments: [e],
    };
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const all = cachedEntries();
    // 1) 搜索过滤（标题/问题/根因/方案/收获/标签）
    const kw = this.search.toLowerCase();
    const searched = kw
      ? all.filter((e) =>
          [e.title, e.problem, e.rootCause, e.solution, e.lesson, ...(e.tags || [])]
            .join('\n')
            .toLowerCase()
            .includes(kw)
        )
      : all;
    // 2) 筛选（项目/标签）
    const filtered = this.filter
      ? searched.filter((e) =>
          this.filter!.type === 'repo'
            ? (e.context?.repo || '') === this.filter!.value
            : (e.tags || []).includes(this.filter!.value)
        )
      : searched;

    // 展开月份节点：返回该月条目（倒序）
    if (element && isGroup(element) && element.kind === 'month') {
      return filtered
        .filter((e) => {
          if (monthOf(e) !== element.key) return false;
          return element.parent
            ? element.parent.kind === 'repo'
              ? (e.context?.repo || '') === element.parent.key
              : (e.tags || []).includes(element.parent.key)
            : true;
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }

    // 展开项目/标签分组：小分组直出条目，大分组按月二级折叠
    if (element && isGroup(element)) {
      const groupEntries = filtered.filter((e) =>
        element.kind === 'repo'
          ? (e.context?.repo || '') === element.key
          : (e.tags || []).includes(element.key)
      );
      if (groupEntries.length <= GROUP_MONTH_THRESHOLD) {
        return groupEntries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }
      return monthGroups(groupEntries, {
        kind: element.kind as 'repo' | 'tag',
        key: element.key,
      });
    }

    // 顶层
    if (this.grouping === 'time') {
      // 按时间：按月折叠，避免一次性平铺全部条目
      return monthGroups(filtered);
    }

    // 按项目 / 按标签 聚合成可折叠分组
    const groups = new Map<string, number>();
    for (const e of filtered) {
      const keys =
        this.grouping === 'project'
          ? [(e.context?.repo || '未知仓库')]
          : e.tags && e.tags.length
          ? e.tags
          : ['未分类'];
      for (const k of keys) {
        groups.set(k, (groups.get(k) || 0) + 1);
      }
    }
    const nodes: GroupNode[] = [...groups.entries()]
      .map(([key, count]) => ({
        __group: true as const,
        kind: this.grouping === 'project' ? ('repo' as const) : ('tag' as const),
        key,
        label: key,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return nodes;
  }
}

/** 把一组条目聚合成月份节点（时间倒序）。parent 为二级折叠时的父分组。 */
function monthGroups(
  entries: Entry[],
  parent?: { kind: 'repo' | 'tag'; key: string }
): GroupNode[] {
  const byMonth = new Map<string, number>();
  for (const e of entries) {
    const m = monthOf(e) || '未标注日期';
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  return [...byMonth.entries()]
    .map(([month, count]) => ({
      __group: true as const,
      kind: 'month' as const,
      key: month,
      label: month,
      count,
      parent,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

function isGroup(n: TreeNode): n is GroupNode {
  return (n as GroupNode).__group === true;
}
