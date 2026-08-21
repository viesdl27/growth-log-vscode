import { execSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export interface RepoInfo {
  repo: string;
  branch: string;
}

// 返回当前工作区 git 仓库根目录（.git 的父目录），失败返回空串
export function getRepoRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return '';
  }
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: folder.uri.fsPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// 检测当前工作区的仓库名与分支
export function detectRepo(): RepoInfo {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const fallbackName = folder ? path.basename(folder.uri.fsPath) : 'unknown';
  if (!folder) {
    return { repo: fallbackName, branch: '' };
  }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: folder.uri.fsPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { repo: fallbackName, branch };
  } catch {
    return { repo: fallbackName, branch: '' };
  }
}

// 获取要记录的代码上下文：优先当前选区，否则取工作区 git diff
export function getDiff(): string {
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.selection.isEmpty) {
    return editor.document.getText(editor.selection);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return '';
  }
  try {
    return execSync('git diff', {
      cwd: folder.uri.fsPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}
