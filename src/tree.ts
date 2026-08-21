import * as vscode from 'vscode';
import { loadEntries, Entry } from './store';

export type Grouping = 'time' | 'project' | 'tag';

export interface GroupNode {
  __group: true;
  kind: 'repo' | 'tag';
  key: string;
  label: string;
  count: number;
}

export type TreeNode = Entry | GroupNode;

export class GrowthTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  grouping: Grouping = 'time';
  // 筛选：只看某个项目或某个标签；null 表示不过滤
  filter: { type: 'repo' | 'tag'; value: string } | null = null;

  setGrouping(g: Grouping): void {
    this.grouping = g;
    this.refresh();
  }

  setFilter(f: { type: 'repo' | 'tag'; value: string } | null): void {
    this.filter = f;
    this.refresh();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (isGroup(node)) {
      const label =
        (node.kind === 'repo' ? '项目 ▸ ' : '标签 ▸ ') + node.label;
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${node.count} 条`;
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    const e = node as Entry;
    const item = new vscode.TreeItem(e.title, vscode.TreeItemCollapsibleState.None);
    const statusTag =
      e.status === 'pending-ai'
        ? '待AI起草'
        : e.status === 'draft'
        ? '待补反思'
        : '';
    item.description = (statusTag ? `· ${statusTag} ` : '') + e.createdAt;
    item.tooltip = (e.tags || []).join(' · ') || statusTag || e.title;
    item.command = {
      command: 'growth-log.openDetail',
      title: '查看',
      arguments: [e],
    };
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const all = loadEntries();
    // 应用筛选
    const filtered = this.filter
      ? all.filter((e) =>
          this.filter!.type === 'repo'
            ? (e.context?.repo || '') === this.filter!.value
            : (e.tags || []).includes(this.filter!.value)
        )
      : all;

    // 展开某个分组
    if (element && isGroup(element)) {
      return filtered
        .filter((e) =>
          element.kind === 'repo'
            ? (e.context?.repo || '') === element.key
            : (e.tags || []).includes(element.key)
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }

    if (this.grouping === 'time') {
      return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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

function isGroup(n: TreeNode): n is GroupNode {
  return (n as GroupNode).__group === true;
}
