import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 与 WorkBuddy Skill 共享的同一份本地库
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
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ version: 1, entries: [] }, null, 2), 'utf-8');
  }
}

export function loadEntries(): Entry[] {
  ensureDb();
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    return Array.isArray(data.entries) ? (data.entries as Entry[]) : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries: Entry[]): void {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify({ version: 1, entries }, null, 2), 'utf-8');
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
