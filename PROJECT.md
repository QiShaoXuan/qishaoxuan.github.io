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

前端部署目标为 `https://qishaoxuan.github.io/`，API 为 `https://101.201.78.159`。前端只发布 `apps/web/dist/`，不发布整个仓库，也不复制原始私人材料、服务端代码或部署配置。

## 本地开发与检查

在仓库根目录执行：

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。连接检查显示 `resume-api` 即表示前端经 Vite 代理连通本机 API；API 默认监听 `127.0.0.1:3000`。Ctrl+C 同时停止两项服务，启动器面向 macOS / Linux。

| 命令 | 用途 |
| --- | --- |
| `npm run dev:web` / `npm run dev:api` | 单独启动前端 / API |
| `npm run typecheck` / `npm run lint` / `npm test` | 类型检查、静态检查、API 测试 |
| `npm run build` | 构建两端，产物分别位于各应用的 `dist/` |
| `npm run build:web` / `npm run build:api` | 单独构建前端 / API |
| `npm run start:api` | 运行已编译 API |

当前前端提供基础连接检查和最小 Mock 聊天联调表单，正式简历展示与完整聊天界面尚待开发。Mock 不调用模型、不回显用户内容、不读取 `private/`；真实知识问答与 SSE 尚未接入。本地检查通过不代表线上已更新。

## 发布基础链路

本阶段发布用于在线验证前后端连通性：现有主页会替换为连接检查页与 Mock 聊天联调表单，聊天使用固定测试回复。

- 前端：`.github/workflows/pages.yml` 在 `master` 推送后检查并构建，只发布 `apps/web/dist/`。仓库 Pages 来源需为 GitHub Actions。
- API：`npm run package:api` 生成 `.artifacts/api-release.tgz`，包含编译代码、最小运行清单和独立生产锁文件；不包含依赖目录或私人资料。在 ECS 新版本目录执行 `npm ci --omit=dev --ignore-scripts` 后，运行 `deploy/activate-api.sh <绝对发布目录>` 预检并切换版本。
- 激活脚本在回环地址 3001 预检候选版本的健康接口及 Mock 聊天（HTTP 200、`mode: "mock"`），原子切换 `current` 并重启服务，健康检查失败自动回滚。公网与浏览器验证另行执行，部署结果以实际验证记录为准。

完整命令、目录和环境变量要求见 [部署说明](deploy/README.md#发布前后端基础架构)。

## 环境变量

无需创建 `.env` 即可本地启动。需要覆盖时，分别复制 `apps/web/.env.example`、`apps/api/.env.example` 为同目录 `.env`，修改后重启服务。Vite 加载前端配置，Node 启动脚本加载后端配置。

| 变量 | 约定 |
| --- | --- |
| `VITE_API_BASE_URL` | 开发默认空值走代理；生产默认 `https://101.201.78.159`，自定义生产值仅接受 HTTPS origin。所有 `VITE_` 值都会公开到浏览器，禁止放密钥。 |
| `API_HOST` / `API_PORT` | 优先于 `HOSTNAME` / `PORT`，默认 `127.0.0.1:3000`。 |
| `API_ALLOWED_ORIGINS` | 生产和测试默认仅 `https://qishaoxuan.github.io`；开发另允许 `http://localhost:5173`、`http://127.0.0.1:5173`。显式配置只能使用对应模式的这些来源。 |
| `API_CHAT_RATE_LIMIT_MAX` / `API_CHAT_RATE_LIMIT_WINDOW_MS` | 默认每 IP 每 60000 毫秒 10 次聊天请求；单进程内存计数，重启清空。 |

生产配置由 `/etc/resume/resume.env` 注入。不要把开发 `.env` 的本机来源复制到生产。模型密钥、SSH 私钥与 TLS 私钥不得提交 Git 或进入静态产物。CORS 仅限制浏览器跨域访问，不替代鉴权和预算控制。

## 接口与资料边界

| 接口 | 当前代码行为 |
| --- | --- |
| `GET /healthz`、`GET /api/health` | 200，`{ "status": "ok", "service": "resume-api" }` |
| `POST /api/chat` | 合法请求返回 200，`{ mode: "mock", message: { role: "assistant", content: string } }` |

Mock 固定回复为：“这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。”

聊天请求只接收 `messages`：1–20 条 `user` / `assistant` 消息，每条 1–4000 字符且不可全为空白；拒绝 `system`、自选模型与额外字段。请求体上限 100 KiB。健康检查和预检不消耗聊天额度；API 不记录聊天正文或请求日志。接入真实模型前仍需总预算、并发控制和异常处理。

`private/` 的原始聊天风格报告只供本地整理，不提交、不上传、不打包。后续先提炼允许公开的语气设定与工作经历知识，再接入服务端；简历事实始终以 [readme.md](readme.md) 为准。
