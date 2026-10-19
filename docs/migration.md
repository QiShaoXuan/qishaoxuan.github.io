# 迁移记录

日期：2026-10-19。

原仓库：`git@github.com:QiShaoXuan/resume.git`，迁移时分支 `codex/resume-ai-site`，最近提交 `d28be414844ff5b9999323920824d6c85b3f68c6`。部署文件和聊天风格报告包含此前尚未提交的本地工作，已一起迁入。

目标仓库：`git@github.com:QiShaoXuan/qishaoxuan.github.io.git`，克隆起点 `dfddfa7`（与 `origin/master` 一致），开发分支 `codex/resume-frontend`。

后续唯一工作目录：`/Users/bytedance/mygit/qishaoxuan.github.io`。原仓库的 Git 历史和已有本地依赖缓存保留，迁移后的项目开发不再依赖原目录。

## 文件对应关系

| 原位置 | 新位置 | 处理 |
| --- | --- | --- |
| `readme.md` | `resume.md` | 原文迁移，作为最新简历源 |
| `resume.html` | `resume.html` | 迁移后根据最新 Markdown 重新生成 |
| `md2html.js` | `md2html.js` | 输入改为 `resume.md`，输出按脚本目录定位 |
| `package.json`、`package-lock.json` | 原文件名 | 依赖及版本锁原样迁移 |
| `齐少轩(前端工程师)的简历.pdf` | `archive/resume-2023/齐少轩(前端工程师)的简历.pdf` | 原样留档；PDF 为 2023-10-10 旧版，不能作为当前简历 |
| `gigacre-work.md` | `content/work-experience/gigacre-work.md` | 早期工作经历底稿 |
| `deploy/` | `deploy/` | ECS、Nginx、systemd、IP HTTPS 与续期配置完整迁移 |
| `mcp-gateway/` | `mcp-gateway/` | 原有空网关配置保留 |
| 聊天风格原始报告 | `private/工作沟通风格分析与角色 Agent 设定（180 天取样）.md` | 本地保留，Git 忽略；含内部链接及工作原话 |
| `blacklist.md` | `private/blacklist.md` | 本地保留，Git 忽略 |
| 原 `.gitignore` 的开发和环境变量规则 | `.gitignore` | 合并到新仓库规则中，增加 `private/` 保护 |

移动时逐文件进行了 SHA256 校验。目标仓库原来的 `index.html` 保持原样；原 `readme.md` 的项目导航列表保留在新的仓库说明末尾。

## 部署边界

前端未来发布至现有 GitHub Pages 根地址，聊天 API 继续使用现有 ECS。迁移没有推送远程、触发 GitHub Pages 发布或更改服务器现有服务。

ECS 健康检查及 IP HTTPS 已在前一阶段配置，迁移保留了全部操作文档。`deploy/README.md` 中 SSH 私钥路径指向本机专用密钥，证书/模型私钥不属于迁移文件。

原始聊天风格材料应先整理为允许公开回答的服务端知识与语气设定，再接入聊天 API。公开前端不得打包原始私人资料或模型密钥。

## 本次验证

- `npm ci --ignore-scripts --no-audit --no-fund`、`npm run md2html` 成功，沿用原依赖及锁文件。
- 最新 ByteDance、AFFiNE 经历已进入生成的 HTML；从仓库内其他工作目录执行转换时仍只更新根目录产物，重复生成内容一致。
- 移动时 Markdown、锁文件、历史 PDF 和经历底稿的 SHA256 与原文件一致；部署目录及私人资料也逐文件校验一致。入库前仅清理了经历底稿两处空白行的行尾空格。
- Node、部署 Shell 脚本语法及 `git diff --check` 通过；两个私人文档均存在、被 Git 忽略且未被跟踪。
- 迁移提交前，目标分支 `codex/resume-frontend` 的提交位置与 `origin/master` 一致；原 `index.html` 与远程基线一致。后续提交与推送状态以 Git 记录为准。
