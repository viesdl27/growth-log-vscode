import * as fs from 'fs';
import * as path from 'path';
import { Entry } from './store';

/**
 * 档案产出渲染（内嵌版）：替代原「调用系统 Python 跑 Skill 脚本」的方式。
 * VS Code 扩展运行于 Node 环境，直接内嵌生成逻辑，零外部依赖——
 * 用户不需要安装 Python，也不需要 WorkBuddy。
 * 产出：entries.md（镜像）/ growth_star.md（STAR 卡）/ growth_index.md（索引）/ growth_dashboard.html（Dashboard）。
 */

function byDate(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function parseDate(s: string): string {
  return (s || '').trim().slice(0, 10);
}

function repoOf(e: Entry): string {
  return e.context?.repo || '未知项目';
}

interface StarObj {
  situation: string;
  task: string;
  action: string;
  result: string;
}

function starOf(e: Entry): StarObj {
  const s = (e.star || {}) as Partial<StarObj>;
  return {
    situation: s.situation || '',
    task: s.task || '',
    action: s.action || '',
    result: s.result || '',
  };
}

function starFallback(e: Entry): StarObj {
  const s = starOf(e);
  if (s.situation || s.task || s.action || s.result) return s;
  return { situation: e.problem || '', task: '', action: e.solution || '', result: e.lesson || '' };
}

function readEntries(dir: string): Entry[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'entries.json'), 'utf-8'));
    return Array.isArray(data.entries) ? (data.entries as Entry[]) : [];
  } catch {
    return [];
  }
}

function writeMirror(dir: string, entries: Entry[]): void {
  const lines: string[] = ['# 成长记录（镜像）'];
  for (const e of byDate(entries)) {
    const star = starOf(e);
    lines.push(`## ${e.title || ''}  `);
    lines.push(`- 日期：${e.createdAt || ''}  `);
    lines.push(`- 标签：${(e.tags || []).join(', ')}  `);
    lines.push(`- 状态：${e.status || ''}  `);
    lines.push('');
    lines.push(`**问题**：${e.problem || ''}  `);
    lines.push(`**根因**：${e.rootCause || ''}  `);
    lines.push(`**方案**：${e.solution || ''}  `);
    lines.push(`**收获**：${e.lesson || ''}  `);
    lines.push('');
    if (star.situation || star.task || star.action || star.result) {
      lines.push(`> S：${star.situation}  `);
      lines.push(`> T：${star.task}  `);
      lines.push(`> A：${star.action}  `);
      lines.push(`> R：${star.result}  `);
      lines.push('');
    }
  }
  fs.writeFileSync(path.join(dir, 'entries.md'), lines.join('\n'), 'utf-8');
}

function writeStar(dir: string, entries: Entry[]): void {
  const lines: string[] = ['# STAR 面试话术卡'];
  let i = 0;
  for (const e of byDate(entries)) {
    const star = starFallback(e);
    if (!(star.situation || star.task || star.action || star.result)) continue;
    i += 1;
    lines.push(`## ${i}. ${e.title || ''}`);
    lines.push('');
    lines.push(`- **Situation**：${star.situation}`);
    if (star.task) lines.push(`- **Task**：${star.task}`);
    lines.push(`- **Action**：${star.action}`);
    lines.push(`- **Result**：${star.result}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dir, 'growth_star.md'), lines.join('\n'), 'utf-8');
}

function writeIndex(dir: string, entries: Entry[]): void {
  const byRepo = new Map<string, Entry[]>();
  const byTag = new Map<string, Entry[]>();
  for (const e of byDate(entries)) {
    const repo = e.context?.repo || '未知仓库';
    byRepo.set(repo, [...(byRepo.get(repo) || []), e]);
    for (const t of (e.tags && e.tags.length ? e.tags : ['未分类'])) {
      byTag.set(t, [...(byTag.get(t) || []), e]);
    }
  }
  const lines: string[] = ['# 成长档案索引（整理地图）', ''];
  lines.push(`> 共 ${entries.length} 条记录。按项目 / 按标签分类，便于定位与导出某一类能力证据。`, '');
  lines.push('## 按项目', '');
  for (const [repo, es] of [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    lines.push(`### ${repo}（${es.length}）`, '');
    for (const e of es) {
      lines.push(`- \`${e.createdAt || ''}\` · ${e.title || ''} — ${e.status || ''}`);
    }
    lines.push('');
  }
  lines.push('## 按标签', '');
  for (const [tag, es] of [...byTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    lines.push(`### ${tag}（${es.length}）`, '');
    for (const e of es) {
      lines.push(`- \`${e.createdAt || ''}\` · ${e.title || ''} — ${e.context?.repo || '未知仓库'}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(dir, 'growth_index.md'), lines.join('\n'), 'utf-8');
}

function writeDashboard(dir: string, entries: Entry[], templatePath: string): void {
  if (!fs.existsSync(templatePath)) return;
  let template: string;
  try {
    template = fs.readFileSync(templatePath, 'utf-8');
  } catch {
    return;
  }
  const payload = {
    entries: entries.map((e) => ({
      id: e.id || '',
      date: parseDate(e.createdAt),
      title: e.title || '',
      repo: repoOf(e),
      status: e.status || 'done',
      tags: e.tags || [],
      problem: e.problem || '',
      rootCause: e.rootCause || '',
      solution: e.solution || '',
      lesson: e.lesson || '',
      star: e.star || {},
    })),
    generatedAt: (() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    })(),
  };
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  const html = template.replace('__DATA__', json);
  fs.writeFileSync(path.join(dir, 'growth_dashboard.html'), html, 'utf-8');
}

/** 一键刷新全部档案产出（镜像 / STAR / 索引 / Dashboard）。 */
export function renderOutputs(dir: string, templatePath: string): void {
  const entries = readEntries(dir);
  writeMirror(dir, entries);
  writeStar(dir, entries);
  writeIndex(dir, entries);
  writeDashboard(dir, entries, templatePath);
}
