#!/usr/bin/env node
// growth-log capture：由 git post-commit 钩子调用，把最近一次提交写到成长档案库。
// 仅采集上下文（status: pending-ai），问题/方案的 AI 起草由扩展后续完成。
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = process.argv[2] || process.cwd();
// 数据目录：优先用扩展通过钩子注入的 GROWTH_LOG_DATA_DIR（用户自定义 dataDir 时），否则默认 ~/.growth-log
const DB_DIR = process.env.GROWTH_LOG_DATA_DIR || path.join(os.homedir(), '.growth-log');
const DB_FILE = path.join(DB_DIR, 'entries.json');
const LOG_FILE = path.join(DB_DIR, 'hook.log');

function log(line) {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

function git(args) {
  return execSync(`git ${args}`, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

try {
  const commit = git('rev-parse HEAD');
  const branch = git('rev-parse --abbrev-ref HEAD');
  const msg = git('log -1 --pretty=%s');

  // 噪音过滤：跳过 merge 提交，无代码改动则跳过
  if (/^Merge\b/i.test(msg)) {
    process.exit(0);
  }
  let diff = '';
  try {
    diff = git('diff HEAD~1 HEAD');
  } catch {
    diff = git('show HEAD');
  }
  if (!diff.trim()) {
    process.exit(0);
  }

  const files = git('diff-tree --no-commit-id --name-only -r HEAD')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const repo = path.basename(repoRoot);

  let data = { version: 1, entries: [] };
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
      log('parse entries.json failed: ' + e);
    }
  }
  if (!Array.isArray(data.entries)) {
    data.entries = [];
  }

  // 按 commit 去重，避免钩子重复触发重复入库
  if (data.entries.some((e) => e.context && e.context.commit === commit)) {
    process.exit(0);
  }

  data.entries.push({
    id: 'gl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString().slice(0, 10),
    title: msg,
    context: {
      repo,
      branch,
      files,
      diff: diff.slice(0, 12000),
      commit,
    },
    problem: '',
    rootCause: '',
    solution: '',
    lesson: '',
    tags: [],
    star: { situation: '', task: '', action: '', result: '' },
    status: 'pending-ai',
  });

  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  log('captured commit ' + commit.slice(0, 8) + ' from ' + repo);
} catch (e) {
  log('capture error: ' + (e && e.stack ? e.stack : e));
}
process.exit(0);
