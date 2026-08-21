import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

// 档案目录：默认与 WorkBuddy Skill 共享 ~/.workbuddy/growth-log；
// 可通过设置 growthLog.dataDir 自定义（发布给普通用户后，他们可指向任意位置）。
export function getDbDir(): string {
  const cfg = vscode.workspace.getConfiguration('growthLog').get<string>('dataDir');
  const dir = (cfg || '').trim();
  return dir ? dir.replace(/\\/g, '/') : path.join(os.homedir(), '.workbuddy', 'growth-log');
}
export function getDbFile(): string {
  return path.join(getDbDir(), 'entries.json');
}
export const DB_DIR = path.join(os.homedir(), '.workbuddy', 'growth-log');
export const DB_FILE = path.join(DB_DIR, 'entries.json');

export interface Star {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface Entry {
  id: string;
  createdAt: string;
  title: string;
  context: {
    repo?: string;
    branch?: string;
    files?: string[];
    diff?: string;
    commit?: string | null;
  };
  problem: string;
  rootCause: string;
  solution: string;
  lesson: string;
  tags: string[];
  star?: Star;
  status?: string;
}

export function ensureDb(): void {
  const dir = getDbDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const file = getDbFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [] }, null, 2), 'utf-8');
  }
}

export function loadEntries(): Entry[] {
  ensureDb();
  try {
    const data = JSON.parse(fs.readFileSync(getDbFile(), 'utf-8'));
    return Array.isArray(data.entries) ? (data.entries as Entry[]) : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries: Entry[]): void {
  ensureDb();
  fs.writeFileSync(getDbFile(), JSON.stringify({ version: 1, entries }, null, 2), 'utf-8');
}

export function appendEntry(e: Entry): void {
  const entries = loadEntries();
  entries.push(e);
  saveEntries(entries);
}

export function updateEntry(id: string, patch: Partial<Entry>): void {
  const entries = loadEntries();
  const idx = entries.findIndex((x) => x.id === id);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...patch };
    saveEntries(entries);
  }
}

export function deleteEntry(id: string): void {
  const entries = loadEntries().filter((x) => x.id !== id);
  saveEntries(entries);
}

export function newId(): string {
  return 'gl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
