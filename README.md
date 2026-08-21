# 成长记录 Growth Log（VS Code 扩展 · 采集端）

把日常开发中改过的代码、踩的坑、调优过的代码，沉淀成面试可展示的能力证据。
本扩展是**采集端 + 本地库 + 查看 UI**；AI 起草 / STAR 生成 / SVG·导出由 **WorkBuddy Skill（growth-log）** 完成。双方共享同一份本地库 `entries.json`。

## 架构（双端协作）

```
┌────────────────────┐        共享 entries.json        ┌──────────────────────┐
│  VS Code 扩展       │ ───────────────────────────▶   │  WorkBuddy Skill      │
│  (本项目)           │ ◀───────────────────────────   │  (growth-log)         │
│  • 读选区/git diff  │   读库 → AI 起草/STAR/雷达/时间线│  • 读 diff 起草问题/方案│
│  • 写 entries.json  │   导出 docx / 腾讯文档          │  • 生成 SVG 与话术卡   │
│  • 侧边栏浏览/卡片  │                                 │  • 导出成长档案         │
└────────────────────┘                                 └──────────────────────┘
```

- 扩展默认**不内置大模型**（零 API key、隐私好、马上能发）。
- **可选启用 B 方案**：运行 `成长记录：配置 AI 模型`，填入任意 OpenAI 兼容的 key（DeepSeek / OpenAI / 通义千问 / 智谱 GLM / Kimi / 自定义）。启用后，提交代码即**自动起草**整条记录，无需再把 diff 贴给 Skill。AI Key 存于 VS Code SecretStorage，不过库文件。
- 本地库位置：`~/.workbuddy/growth-log/entries.json`（与 Skill 完全一致）。
- 扩展存完会自动尝试调用 Skill 的 `render.py` 刷新产出（需本机有 python 且脚本存在，失败忽略）。
- **详情页可直接编辑**：点开任意记录 → 「✏️ 编辑此记录」→ 预填表单改完保存，即更新原条目（根因/收获可在 VS 内直接补）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `成长记录：记录这次成长` | 读当前选区或 `git diff`，弹出四段反思表单，保存入库 |
| `成长记录：刷新列表` | 刷新侧边栏（钩子写入后会自动刷新，无需手动） |
| `成长记录：打开成长档案文件夹` | 在资源管理器打开 `~/.workbuddy/growth-log/` |
| `成长记录：安装提交钩子` | 给当前仓库写 `.git/hooks/post-commit`，此后每次 commit 自动抓取上下文 |
| `成长记录：卸载提交钩子` | 删除该钩子 |
| `成长记录：删除此记录`（右键条目） | 删除一条记录（用于清理自动抓取的噪音） |
| `成长记录：编辑此记录`（右键条目 / 详情页按钮） | 打开预填表单，直接修改并保存该记录 |
| `成长记录：配置 AI 模型`（B 方案） | 选择厂商并填入 API Key，启用后提交即自动起草 |
| `成长记录：查看成长可视化` | 在扩展内跟随主题查看雷达图 + 时间线 + 记录清单 |

侧边栏：活动栏出现「成长记录」图标，树状按时间倒序列出所有记录；点开为详情卡片（四段反思 + 标签 + diff + STAR 预览）。`pending-ai` 条目显示「· 待AI起草」，`draft` 显示「· 待补反思」。

## 使用流程

1. 在编辑器里**选中**要记的代码（或确保工作区有未提交的 `git diff`）。
2. `Ctrl/Cmd+Shift+P` → `成长记录：记录这次成长`。
3. 表单已预填代码上下文，补全 **标题 / 问题 / 根因 / 方案 / 收获 / 标签**。
   - 已配置 AI 模型时，点「✨ AI 起草」可一键根据代码上下文自动填充全文（再人工确认/补充）。
   - 「根因 / 收获」最有思考深度，建议自己写；可先采纳 AI 起草再改成自己的话。
4. 点「保存到成长档案」→ 侧边栏即时更新，本地库写入。
5. 在 WorkBuddy 对话里说「生成 STAR / 雷达 / 时间线」或「导出成长档案」，由 Skill 产出面试弹药。

## 自动抓取（git 提交钩子）

不想手动点表单？装好钩子后**每次 `git commit` 自动囤原始素材**：

1. 在任意 git 仓库的 VS Code 窗口里，执行 `成长记录：安装提交钩子`（仅对当前仓库生效，写 `.git/hooks/post-commit`）。
2. 之后每次提交，钩子自动把本次提交的 repo / 分支 / commit / 改动文件 / diff 写入 `entries.json`，`status: pending-ai`，侧边栏即时显示「· 待AI起草」。
3. **已配置 AI 模型（B 方案）**：扩展会监听本地库，发现 `pending-ai` 即自动调用 LLM 起草整条记录并改 `status: draft`，并弹窗提示你去「补充/确认根因与收获」。
4. **未配置 AI 模型**：攒几条后，在 WorkBuddy 对话里说「**起草待办**」，Skill 批量读这些 pending-ai 条目、依 diff 起草 problem/solution/rootCause/lesson 并写回（status 改 `draft`）。
5. 你补 `rootCause` / `lesson` / `tags` 后（在 VS 内点「编辑此记录」即可直接改），改 `done` 即成为正式面试弹药。

- 噪音过滤：跳过 merge 提交与空 diff，按 commit 去重，避免重复入库。
- 钩子需要 `node`：优先用 PATH 中的 `node`，否则回退到 WorkBuddy 受管 node（`C:/Users/29414/.workbuddy/binaries/node/versions/22.22.2/node.exe`）。
- 自动抓取**只囤上下文，不写反思**；反思层必须本人补。无价值的 pending-ai 条目可在侧边栏右键删除。
- 卸载：`成长记录：卸载提交钩子`。

## 开发 / 调试

```bash
npm install          # 已安装，可跳过
npm run typecheck    # tsc --noEmit 类型检查
npm run build        # esbuild 打包到 dist/extension.js
npm run watch        # 监听改动热构建
```

- **调试**：用 VS Code 打开本项目，`F5` 启动「扩展开发宿主」窗口，在新窗口里测试命令与侧边栏。
- **打包**：`npx @vscode/vsce package` 生成 `.vsix`，在 VS Code 扩展面板「从 VSIX 安装」。
  - 首次发布需 `vsce login <publisher>`（publisher 见 package.json）。

## 条目结构（entries.json）

```json
{
  "id": "gl-xxx",
  "createdAt": "2026-08-21",
  "title": "…",
  "context": { "repo": "LogSage", "branch": "main", "files": [], "diff": "…", "commit": null },
  "problem": "…", "rootCause": "…", "solution": "…", "lesson": "…",
  "tags": ["重构", "代码质量", "Java"],
  "star": { "situation": "…", "task": "…", "action": "…", "result": "…" },
  "status": "done"
}
```

> 红线：反思层（rootCause/lesson）必须由本人补；不自动抓全量 commit；导出前脱敏。
