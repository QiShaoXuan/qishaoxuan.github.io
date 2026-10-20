# 简历网站项目说明

简历正文与最新工作经历统一维护在 [readme.md](readme.md)。本文件说明开发、配置和当前功能边界；服务器及证书操作见 [deploy/README.md](deploy/README.md)。

## 结构与技术栈

使用 npm workspaces，要求 Node.js 24、npm 11。统一工作目录为 `/Users/bytedance/mygit/qishaoxuan.github.io`。

| 位置 | 职责 |
| --- | --- |
| `apps/web/` | React + TypeScript + Vite 静态前端 |
| `apps/api/` | Node.js + TypeScript + Fastify HTTP API |
| `scripts/` | 本地启动及构建辅助脚本 |
| `deploy/` | ECS、Nginx、systemd、IP HTTPS 与证书续期配置 |
| `private/` | 本机原始聊天风格资料，Git 忽略，禁止发布 |

正式环境为 `https://qishaoxuan.github.io/` 与 `https://101.201.78.159/api`；开发环境为 `https://qishaoxuan.github.io/dev/` 与 `https://101.201.78.159/dev/api`。Pages 只发布两环境 `apps/web/dist/` 合并后的静态文件与公开版本元数据，不发布整个仓库，也不复制原始私人材料、服务端代码或部署配置。

## 本地开发与检查

在仓库根目录执行：

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:8080` 查看简历，点击右下角聊天入口测试 Mock 收发。前端经 Vite 代理连接本机 API，API 默认监听 `127.0.0.1:3000`。Ctrl+C 同时停止两项服务，启动器面向 macOS / Linux。

| 命令 | 用途 |
| --- | --- |
| `npm run dev:web` / `npm run dev:api` | 单独启动前端 / API |
| `npm run typecheck` / `npm run lint` / `npm test` | 类型检查、静态检查、前后端测试 |
| `npm run build` | 构建两端，产物分别位于各应用的 `dist/` |
| `npm run build:web` / `npm run build:api` | 单独构建前端 / API |
| `npm run start:api` | 运行已编译 API |

当前前端基于 Kami resume 模板展示完整简历，直接读取根目录 `readme.md`。聊天默认收起于右下角，桌面支持拖动浮窗、边缘吸附、左右全高停靠并给正文让出空间；手机使用全屏面板。窗口关闭后保留本页会话，刷新后清空。

图标使用 Heroicons，聊天输入与等待状态改编自 Beautiful UI，状态由实际 Mock 请求驱动。Mock 不调用模型、不读取 `private/`；真实知识问答与 SSE 尚未接入。本地检查通过不代表线上已更新。视觉规则和上游版本见 [DESIGN.md](DESIGN.md)，开源许可随构建发布在 `/THIRD_PARTY_NOTICES.txt`。

页面优先使用系统苹方（PingFang SC），无苹方的设备回退到系统无衬线字体，不打包或请求字体文件。块间距与行距参考 [Kami 示例简历](https://kami.tw93.fun/assets/demos/demo-musk-resume.pdf)：正文行高 1.45，章节上间距 28px（手机 24px）、标题下间距 10px、段落间距 6px、项目上下内边距各 12px。

## 双环境自动发布

2026-10-20 已完成阿里云 IAM/OIDC、GitHub Environments 和服务器双环境初始化。正式环境已通过 [Actions 39379174679](https://github.com/QiShaoXuan/qishaoxuan.github.io/actions/runs/39379174679) 发布，公网健康接口与 Mock 对话已验证。开发环境的 API 已部署，Pages 公网版本仍待确认；校验通过前不会保存新的成功状态。

| 分支 | GitHub Environment | 前端路径 | API 前缀 | ECS 用户 / 端口 |
| --- | --- | --- | --- | --- |
| `master` | `production` | `/` | `https://101.201.78.159/api` | `resume` / 3000 |
| `develop` | `development` | `/dev/` | `https://101.201.78.159/dev/api` | `resume-dev` / 3100 |

`.github/workflows/pages.yml` 对两分支 PR 执行 Lint、类型、测试与构建；push 或对应分支手动触发在校验后发布。release 全局串行，先通过 ECS 云助手部署并验证目标 API，再合并当前环境的静态构建与另一环境上次成功产物，统一发布同一个 Pages 站点。

GitHub Environments 已各设置 `ECS_INSTANCE_ID`、`ALIYUN_ROLE_ARN`、`ALIYUN_OIDC_PROVIDER_ARN` 三个变量。`production` 仅允许 `master`，`development` 仅允许 `develop`；两个 RAM 角色的 OIDC 信任分别绑定各环境，云助手执行权限分别限制为 `resume` 与 `resume-dev`。使用临时凭证，不保存长期访问密钥。服务器已由 `root` 通过云助手执行 `deploy/setup-environments.sh` 完成一次性初始化；后续发布不需要 SSH / SCP。OIDC provider 为 `resume-github-actions`，正式与开发角色分别为 `resume-github-production`、`resume-github-development`；配置证据及首轮发布状态见 [部署记录](deploy/README.md#双环境配置记录2026-10-20)。

两套线上 API 都使用 `NODE_ENV=production`，通过 `RELEASE_COMMIT` 和 `DEPLOY_ENV=prod|dev` 区分版本，而非使用 Node 开发模式。API 发布包包含 `version.json` 与 `release.env`，健康响应包含提交及环境。Pages 根目录 `deployment-state.json` 记录整站 generation 和两环境 commit，各前端路径的 `version.json` 记录自身版本。

`pages-state` 分支只保存成功验证后的完整静态站点及元数据。必须先发布 `master` 创建正式站点，再发布 `develop`。发布前若公网状态与该分支不一致，流程失败并等待从已发布 run 的 `github-pages` artifact 恢复；不得重新构建另一分支 HEAD 替代线上版本。后端成功而前端失败时，后端保留新版本，旧前端继续服务；Pages 已发布但状态保存失败时，先恢复状态再重试。

完整初始化、发布、验证与状态恢复命令见 [部署说明](deploy/README.md#双环境自动部署)。

## 环境变量

无需创建 `.env` 即可本地启动。需要覆盖时，分别复制 `apps/web/.env.example`、`apps/api/.env.example` 为同目录 `.env`，修改后重启服务。Vite 加载前端配置，Node 启动脚本加载后端配置。

| 变量 | 约定 |
| --- | --- |
| `VITE_API_BASE_URL` | 开发默认空值走代理；生产默认 `https://101.201.78.159`，自定义生产值仅接受 HTTPS origin 或其 `/dev` 前缀，开发环境构建使用 `https://101.201.78.159/dev`。所有 `VITE_` 值都会公开到浏览器，禁止放密钥。 |
| `API_HOST` / `API_PORT` | 优先于 `HOSTNAME` / `PORT`，默认 `127.0.0.1:3000`。 |
| `API_ALLOWED_ORIGINS` | 生产和测试默认仅 `https://qishaoxuan.github.io`；开发另允许 `http://localhost:8080`、`http://127.0.0.1:8080`。显式配置只能使用对应模式的这些来源。 |
| `API_CHAT_RATE_LIMIT_MAX` / `API_CHAT_RATE_LIMIT_WINDOW_MS` | 默认每 IP 每 60000 毫秒 10 次聊天请求；单进程内存计数，重启清空。 |

正式与开发配置分别由 `/etc/resume/resume.env`、`/etc/resume-development/resume.env` 注入；两者的 `NODE_ENV` 都是 `production`。不要把开发 `.env` 的本机来源复制到生产。模型密钥、SSH 私钥与 TLS 私钥不得提交 Git 或进入静态产物。CORS 仅限制浏览器跨域访问，不替代鉴权和预算控制。

## 接口与资料边界

| 接口 | 当前代码行为 |
| --- | --- |
| `GET /healthz`、`GET /api/health` | 200，`{ "status": "ok", "service": "resume-api" }`；带发布元数据时另含 `commit` 与 `environment` |
| `POST /api/chat` | 合法请求返回 200，`{ mode: "mock", message: { role: "assistant", content: string } }` |

Mock 固定回复为：“这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。”

聊天请求只接收 `messages`：1–20 条 `user` / `assistant` 消息，每条 1–4000 字符且不可全为空白；拒绝 `system`、自选模型与额外字段。请求体上限 100 KiB。健康检查和预检不消耗聊天额度；API 不记录聊天正文或请求日志。接入真实模型前仍需总预算、并发控制和异常处理。

`private/` 的原始聊天风格报告只供本地整理，不提交、不上传、不打包。后续先提炼允许公开的语气设定与工作经历知识，再接入服务端；简历事实始终以 [readme.md](readme.md) 为准。
