import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getDbDir } from './store';
import { getRepoRoot } from './git';

// 把 capture.js 复制到稳定位置（档案目录/capture.js）。
// 钩子指向稳定路径而非扩展目录，避免扩展升级/卸载后钩子失效。
function ensureStableCaptureScript(context: vscode.ExtensionContext): string {
  const dbDir = getDbDir();
  const dest = path.join(dbDir, 'capture.js');
  const src = path.join(context.extensionPath, 'scripts', 'capture.js');
  try {
    if (fs.existsSync(src)) {
      fs.mkdirSync(dbDir, { recursive: true });
      fs.copyFileSync(src, dest);
    }
  } catch {
    // 复制失败时回退到扩展内路径（installHook 里兜底）
  }
  return dest;
}

function buildHookBody(scriptPath: string): string {
  const dbDir = getDbDir();
  return [
    '#!/bin/sh',
    '# 由「成长记录」扩展自动安装：提交后自动抓取上下文写入成长档案库',
    `HOOK_LOG="${dbDir}/hook.log"`,
    'NODE_BIN="node"',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "成长记录：需要 Node.js 才能自动抓取，请先安装 node" >> "$HOOK_LOG" 2>&1',
    '  exit 0',
    'fi',
    `export GROWTH_LOG_DATA_DIR="${dbDir}"`,
    `SCRIPT="${scriptPath}"`,
    'ROOT="$(git rev-parse --show-toplevel)"',
    'if [ -f "$SCRIPT" ]; then',
    '  "$NODE_BIN" "$SCRIPT" "$ROOT" >> "$HOOK_LOG" 2>&1',
    'fi',
    '',
  ].join('\n');
}

// 自愈：若当前仓库的钩子指向已不存在的脚本路径（扩展被卸载/升级导致），改写为稳定路径
export function healHook(context: vscode.ExtensionContext): void {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    return;
  }
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) {
    return;
  }
  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes('成长记录')) {
    return; // 不是本扩展装的钩子，不动
  }
  const m = content.match(/SCRIPT="([^"]+)"/);
  if (m && fs.existsSync(m[1])) {
    return; // 脚本路径仍有效，无需修复
  }
  const stable = ensureStableCaptureScript(context).replace(/\\/g, '/');
  try {
    fs.writeFileSync(hookPath, buildHookBody(stable), { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // 修复失败不打扰用户
  }
}

export async function installHook(context: vscode.ExtensionContext): Promise<void> {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage('当前工作区不是 git 仓库，无法安装提交钩子');
    return;
  }
  const hookDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hookDir, 'post-commit');
  // 优先用稳定路径；复制失败时回退扩展内路径
  let stable = ensureStableCaptureScript(context).replace(/\\/g, '/');
  if (!fs.existsSync(stable)) {
    stable = path
      .join(context.extensionPath, 'scripts', 'capture.js')
      .replace(/\\/g, '/');
  }
  const hookBody = buildHookBody(stable);

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

export async function uninstallHook(): Promise<void> {
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
