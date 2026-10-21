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

打开 `http://127.0.0.1:8080` 查看简历，点击右下角聊天入口测试聊天收发（默认 Mock）。前端经 Vite 代理连接本机 API，API 默认监听 `127.0.0.1:3000`。Ctrl+C 同时停止两项服务，启动器面向 macOS / Linux。

| 命令 | 用途 |
| --- | --- |
| `npm run dev:web` / `npm run dev:api` | 单独启动前端 / API |
| `npm run typecheck` / `npm run lint` / `npm test` | 类型检查、静态检查、前后端测试 |
| `npm run build` | 构建两端，产物分别位于各应用的 `dist/` |
| `npm run build:web` / `npm run build:api` | 单独构建前端 / API |
| `npm run start:api` | 运行已编译 API |

当前前端基于 Kami resume 模板展示完整简历，直接读取根目录 `readme.md`。聊天默认收起于右下角，桌面支持拖动浮窗、边缘吸附、左右全高停靠并给正文让出空间；手机使用全屏面板。聊天记录保存在浏览器 localStorage，保留 7 天并按环境命名空间区分；同源的正式与开发路径并非安全隔离。按序列化 UTF-8 大小计，记录达到 500 KiB 后保留原内容并禁止继续发送，提示清除聊天缓存；超限原始记录即使无法恢复也不会被自动覆盖或按普通损坏数据删除，需手动确认清理；清空前需确认，只删除当前环境的对话。记录保存与模型上下文窗口分别控制，不再为控制缓存大小静默删除旧轮次。支持取消流式生成；取消或异常中断的不完整回复不作为后续模型历史。

图标使用 Heroicons，聊天输入与等待状态改编自 Beautiful UI。默认 `API_CHAT_MODE=mock` 不调用模型；`deepseek` 模式启用服务端 DeepSeek 流式问答。本地已完成真实模型与浏览器链路验证；线上是否调用真实模型取决于各环境服务端配置，不能以代码合并或部署成功代替模型验证。真实模型付费 smoke 的结果单独记录，不以 Mock 或部署探针通过代替。视觉规则和上游版本见 [DESIGN.md](DESIGN.md)，开源许可随构建发布在 `/THIRD_PARTY_NOTICES.txt`。

页面优先使用系统苹方（PingFang SC），无苹方的设备回退到系统无衬线字体，不打包或请求字体文件。块间距与行距参考 [Kami 示例简历](https://kami.tw93.fun/assets/demos/demo-musk-resume.pdf)：正文行高 1.45，章节上间距 28px（手机 24px）、标题下间距 10px、段落间距 6px、项目上下内边距各 12px。

## 双环境自动发布

2026-10-20 已完成双环境自动部署及公网验证：正式环境首次成功运行为 [Actions 39379174679](https://github.com/QiShaoXuan/qishaoxuan.github.io/actions/runs/39379174679)（`f7c0f67f83598b4538772ad6e859f97e7478a22f`），开发环境为 [Actions 39380080618](https://github.com/QiShaoXuan/qishaoxuan.github.io/actions/runs/39380080618)（`a4a61aeda93636c0592ae79da9732e4b5e0e85bb`）。两套简历页面、HTTPS API 与浏览器 Mock 对话均已验证；当前线上版本以公网元数据为准，不以此处历史提交号或分支 HEAD 代替。

| 分支 | GitHub Environment | 前端路径 | API 前缀 | ECS 用户 / 端口 |
| --- | --- | --- | --- | --- |
| `master` | `production` | `/` | `https://101.201.78.159/api` | `resume` / 3000 |
| `develop` | `development` | `/dev/` | `https://101.201.78.159/dev/api` | `resume-dev` / 3100 |

`.github/workflows/pages.yml` 对两分支 PR 执行 Lint、类型、测试与构建；push 或对应分支手动触发在校验后发布。release 全局串行，先通过 ECS 云助手部署并验证目标 API，再合并当前环境的静态构建与另一环境上次成功产物，统一发布同一个 Pages 站点。

日常开发先推送 `develop`，等待其自动发布与 `/dev/` 浏览器验证通过，再通过 PR 以 merge commit 合入 `master`，触发正式发布。每次发布只更新目标环境，保留另一环境最后一次成功发布的静态产物；确认运行结果和公网 `deployment-state.json`、各路径 `version.json`，不要只看分支代码。

GitHub Environments 已各设置 `ECS_INSTANCE_ID`、`ALIYUN_ROLE_ARN`、`ALIYUN_OIDC_PROVIDER_ARN` 三个变量。`production` 仅允许 `master`，`development` 仅允许 `develop`；两个 RAM 角色的 OIDC 信任分别绑定各环境，云助手执行权限分别限制为 `resume` 与 `resume-dev`。使用临时凭证，不保存长期访问密钥。服务器已由 `root` 通过云助手执行 `deploy/setup-environments.sh` 完成一次性初始化；后续发布不需要 SSH / SCP。OIDC provider 为 `resume-github-actions`，正式与开发角色分别为 `resume-github-production`、`resume-github-development`；配置证据及首轮发布状态见 [部署记录](deploy/README.md#双环境配置记录2026-10-20)。

两套线上 API 都使用 `NODE_ENV=production`，通过 `RELEASE_COMMIT` 和 `DEPLOY_ENV=prod|dev` 区分版本，而非使用 Node 开发模式。API 发布包包含 `version.json` 与 `release.env`，健康响应包含提交及环境。Pages 根目录 `deployment-state.json` 记录整站 generation 和两环境 commit，各前端路径的 `version.json` 记录自身版本。

`pages-state` 分支只保存成功验证后的完整静态站点及元数据。必须先发布 `master` 创建正式站点，再发布 `develop`。发布前若公网状态与该分支不一致，流程失败并等待从已发布 run 的 `github-pages` artifact 恢复；不得重新构建另一分支 HEAD 替代线上版本。后端成功而前端失败时，后端保留新版本，旧前端继续服务；Pages 已发布但状态保存失败时，先恢复状态再重试。

完整初始化、发布、验证与状态恢复命令见 [部署说明](deploy/README.md#双环境自动部署)。

## 环境变量

默认 Mock 无需创建 `.env` 即可本地启动。真实模型请在本机 `apps/api/.env` 配置 `API_CHAT_MODE=deepseek` 和 `DEEPSEEK_API_KEY`，不要在聊天消息、前端变量或 Git 中填写密钥。需要覆盖时，分别复制 `apps/web/.env.example`、`apps/api/.env.example` 为同目录 `.env`，修改后重启服务。Vite 加载前端配置，Node 启动脚本加载后端配置。

| 变量 | 约定 |
| --- | --- |
| `VITE_API_BASE_URL` | 开发默认空值走代理；生产默认 `https://101.201.78.159`，自定义生产值仅接受 HTTPS origin 或其 `/dev` 前缀，开发环境构建使用 `https://101.201.78.159/dev`。所有 `VITE_` 值都会公开到浏览器，禁止放密钥。 |
| `API_HOST` / `API_PORT` | 优先于 `HOSTNAME` / `PORT`，默认 `127.0.0.1:3000`。 |
| `API_ALLOWED_ORIGINS` | 生产和测试默认仅 `https://qishaoxuan.github.io`；开发另允许 `http://localhost:8080`、`http://127.0.0.1:8080`。显式配置只能使用对应模式的这些来源。 |
| `API_CHAT_RATE_LIMIT_MAX` / `API_CHAT_RATE_LIMIT_WINDOW_MS` | 默认每 IP 每 60000 毫秒 10 次聊天请求；单进程内存计数，重启清空。 |
| `API_CHAT_MODE` | 默认 `mock`；设为 `deepseek` 才调用模型，缺少服务端密钥时拒绝启动。 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 密钥仅保存在 API 环境中；模型默认 `deepseek-flash`。 |
| `API_CHAT_TIMEOUT_MS` | 单次上游请求超时，默认 60000 毫秒。 |
| `API_CHAT_MAX_TOKENS` | 输出 token 上限，默认 1024，最大 2048。 |
| `API_CHAT_MAX_CONCURRENCY` | 进程内并发上限，默认 2。 |
| `API_CHAT_DAILY_LIMIT` | 进程内每日模型请求上限，默认 100，按 UTC 日期重置；重启清空，不是持久化账单或硬预算。 |

正式与开发配置分别由 `/etc/resume/resume.env`、`/etc/resume-development/resume.env` 注入；两者的 `NODE_ENV` 都是 `production`。不要把开发 `.env` 的本机来源复制到生产。模型密钥、SSH 私钥与 TLS 私钥不得提交 Git 或进入静态产物。CORS 仅限制浏览器跨域访问，不替代鉴权和预算控制。

## 接口与资料边界

| 接口 | 当前代码行为 |
| --- | --- |
| `GET /healthz`、`GET /api/health` | 200，`{ "status": "ok", "service": "resume-api" }`；带发布元数据时另含 `commit` 与 `environment` |
| `POST /api/chat` | 默认 Mock，`deepseek` 模式调用模型；`Accept: text/event-stream` 返回 SSE（meta / delta / done / error），否则返回兼容 JSON。浏览器仅将正常完成的回复作为后续历史。无效输入返回 400 与 `code: "INVALID_REQUEST"`。 |

聊天请求只接收 `messages`：1–20 条 `user` / `assistant` 消息，每条 1–4000 字符且不可全为空白；拒绝 `system`、自选模型与额外字段。请求体上限 100 KiB。部署探针仅发送 `{"messages":[]}` 验证路由与校验，不提交有效聊天、不调用模型；健康和 CORS 预检也不调用模型。

根目录 [readme.md](readme.md) 是唯一简历事实来源。[AFFiNE / BlockSuite 项目资料](docs/knowledge/affine.md) 第 1–6 节与[字节跳动项目资料](docs/knowledge/bytedance.md) 第 1–5 节补充经本人确认的实现、选型和个人过程；任职时间以简历为准，具体职责按项目资料中更明确且不扩大的边界回答。字节资料已脱敏：内部名称、标识和精确业务指标不供回答，保留公开技术参数、统计窗口及个人/团队归属。

构建脚本只读取上述三份白名单输入，每份上限 64 KiB。模型用简历移除项目经验中的旧版 ByteDance 段，字节项目改由已脱敏正文提供，保留简历中的任职时间和其他经历；根简历及前端展示不变。项目文档头部、概览、批准正文之后的维护说明（AFFiNE 第 7 节起、字节跳动第 6 节起）、证据索引及归档提交 TSV 不进入模型。脚本校验章节完整性，生成三个实际模型输入的独立版本和聚合版本；每次 DeepSeek 请求提供三份正文，不使用向量数据库或额外检索服务。API 发布包使用顶层生成 JS 文件，不上传 Markdown 或 `private/`。原始私密聊天风格资料仅留本机；服务端仅使用提炼后的公开表达规则。

JSON 与 SSE 完成事件返回同一组参考来源：公开简历、AFFiNE 项目资料、字节跳动项目资料，以及当次读取成功的 GitHub README。三个本地来源的 ID 含实际输入的内容版本；部署后链接绑定 `RELEASE_COMMIT` 下的原文件，未提交的本地资料不伪造公开 URL。参考列表表示提供给模型的资料，不是逐句归因；简历链接指向完整原文件，模型仅使用上述裁剪部分。结构化日志的 `knowledgeVersion` 覆盖三份实际正文，`knowledgeRefs` 记录本地来源标识，`repositoryRefs` 只记录成功读取的 README。

DeepSeek 模式会按当前问题及有限的用户追问历史，匹配 AFFiNE、BlockSuite、CSS Tricks、JS Tricks、Blog、wavejs 六个固定公开仓库，每次最多两个。服务端读取 GitHub README 作为项目功能与技术背景，回答下方展示实际读取成功、绑定提交的来源链接；README 不代表完整源码分析，仓库整体功能不自动归为个人贡献。先读取仓库 HEAD 的 README，成功缓存一小时；匿名 API 限流或失败时，回退至已核实提交和准确路径的官方原始文件，提示词明确这是固定快照、可能不是最新版本。每仓总限时 6 秒，失败缓存一分钟；全部失败仍可依据已加载的简历、AFFiNE 与字节跳动项目资料回答，仅在需要核对当前仓库时说明无法读取。无需 GitHub 密钥，DeepSeek 密钥不会发送给 GitHub；Mock 模式不读取仓库。

服务端输出结构化运行日志，systemd 收集到 journal，记录请求状态、耗时、prompt / knowledge 版本等排查信息；不记录聊天正文、完整 prompt、上游响应正文或密钥。日志用于本地定位，未接入外部日志平台。进程内限流、并发和每日计数不能替代持久化账单预算。

真实模型 smoke 属于独立、显式的本机付费功能检查：配置好本机 API Key 后，通过本机聊天面板或下面命令检查 SSE；自动构建与部署不会执行它。

```bash
# 先启动本机 deepseek 模式 API；此命令会发起一次真实模型请求并可能计费。
curl --no-buffer --fail-with-body http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  --data '{"messages":[{"role":"user","content":"请简要介绍公开简历中的工作经历"}]}'
```
