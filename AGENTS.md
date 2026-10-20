# 项目约定

- 使用中文沟通。后续简历前端、聊天服务、内容和部署配置统一在本仓库维护，不依赖旧 `/Users/bytedance/mygit/resume` 工作目录。
- 最新简历事实以根目录 `readme.md` 为唯一来源；项目运行与配置说明见 `PROJECT.md`，部署操作见 `deploy/README.md`。不要恢复已删除的旧简历、导航页和转换工具。
- 前端目标是现有 GitHub Pages `https://qishaoxuan.github.io/`；聊天接口继续使用 ECS `https://101.201.78.159/api/chat`。本地代码提供连接检查页、最小 Mock 聊天表单与固定回复接口，真实模型尚未接入；线上版本以实际发布验证为准。
- `private/` 仅供本地整理原始聊天风格和私人求职资料，已被 Git 忽略；不得提交、上传或打包进公开静态产物。需先整理允许公开回答的内容，再接入服务端。
- 模型密钥、SSH 私钥和 TLS 私钥不进入前端或 Git；ECS 配置与验证记录见 `deploy/README.md`。
- GitHub Pages 只发布明确的前端静态构建产物，不直接发布整个工作目录。跨域来源是 `https://qishaoxuan.github.io`，不含路径。
- 使用 npm workspaces：`apps/web` 为 React + TypeScript + Vite，`apps/api` 为 Node.js + TypeScript + Fastify；Node 24、npm 11。根目录 `npm run dev` 同时启动两端。
- Pages 只发布 `apps/web/dist/`，不发布仓库根目录。发布命令与流程维护在 `deploy/README.md`。
- 本地 API 提供 `/healthz`、`/api/health`；`POST /api/chat` 合法请求返回 200 和 `{ mode: "mock", message: { role: "assistant", content: string } }`，固定内容为“这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。”；不调用模型、不回显用户内容、不读取 `private/`。上线前必须保留服务端输入校验与额度控制。
- 修改后执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。本地构建不等于已发布；未经当前任务授权不更改线上服务。
