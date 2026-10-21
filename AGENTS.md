# 项目约定

- 使用中文沟通。后续简历前端、聊天服务、内容和部署配置统一在本仓库维护，不依赖旧 `/Users/bytedance/mygit/resume` 工作目录。
- 最新简历事实以根目录 `readme.md` 为唯一来源；经本人确认的 `docs/knowledge/affine.md` 与已脱敏的 `docs/knowledge/bytedance.md` 补充项目实现、选型和个人过程，不能覆盖简历的任职时间或扩大职责；具体贡献按项目资料中更明确且不扩大的边界回答。项目运行与配置说明见 `PROJECT.md`，部署操作见 `deploy/README.md`。不要恢复已删除的旧简历、导航页和转换工具。
- `master` 发布正式环境：Pages 根路径、ECS `/api`、回环端口 3000、用户 `resume`；`develop` 发布开发环境：Pages `/dev/`、ECS `/dev/api`、回环端口 3100、用户 `resume-dev`。两环境线上均使用 `NODE_ENV=production`，`RELEASE_COMMIT` 和 `DEPLOY_ENV=prod|dev` 标识版本。前端基于 Kami resume 模板，使用 Heroicons 与 Beautiful UI 聊天组件，视觉约定见 `DESIGN.md`。聊天支持浮窗拖动、左右全高停靠并给正文让出空间，手机全屏；默认 Mock，可配置 DeepSeek SSE；线上版本与模型启用状态以实际发布及服务端配置为准。
- 简历直接读取根目录 `readme.md`，不得额外维护一份事实副本。字体按用户要求优先使用系统苹方（PingFang SC），无苹方的设备回退到系统无衬线；不打包字体文件。间距参考 Kami `demo-musk-resume.pdf`，保留第三方许可声明。
- 静态 PDF 由同一个 `ResumePage` 渲染，下载名称为 `齐少轩的简历.pdf`。`npm run dev` 监听 README / 排版并生成；单独修改后执行 `npm run resume:sync`，将 `apps/web/public/resume.pdf` 与 `apps/web/src/resume/pdf-metadata.json` 一起更新。前端 prebuild 校验来源与产物哈希，禁止绕过过期检查。Playwright / pdf-lib 仅为本地导出依赖，CI 不生成 PDF，ECS 与前端不引入浏览器运行时；排版修改需核验 PDF 全部页面。
- `private/` 仅供本地整理原始聊天风格和私人求职资料，已被 Git 忽略；不得提交、上传或打包进公开静态产物。需先整理允许公开回答的内容，再接入服务端。
- 模型密钥、SSH 私钥和 TLS 私钥不进入前端或 Git；ECS 配置与验证记录见 `deploy/README.md`。
- Git 操作优先使用本机 Git；后续阿里云服务器管理、部署和排障仅通过 IAB 浏览器中的 ECS 云助手，不再使用 SSH / SCP，也不因本机出口 IP 变化调整 SSH 白名单。应用操作分别以 `resume` / `resume-dev` 执行；仅首次通过 `root` 云助手运行 `deploy/setup-environments.sh` 初始化双环境。后续 Actions 通过 OIDC 临时凭证与各自 RAM 角色部署，不使用长期访问密钥。
- GitHub Pages 只发布明确的前端静态构建产物，不直接发布整个工作目录。跨域来源是 `https://qishaoxuan.github.io`，不含路径。
- 使用 npm workspaces：`apps/web` 为 React + TypeScript + Vite，`apps/api` 为 Node.js + TypeScript + Fastify；Node 24、npm 11。根目录 `npm run dev` 同时启动两端。
- 两分支的 PR 执行校验，push 校验后自动发布；release 全局串行，GitHub Environments `production` 仅允许 `master`、`development` 仅允许 `develop`。每环境配置 `ECS_INSTANCE_ID`、`ALIYUN_ROLE_ARN`、`ALIYUN_OIDC_PROVIDER_ARN`，角色只能以本环境 OS 用户执行云助手命令。
- `pages-state` 只保存上次成功验证的完整静态站点与版本元数据，不存源码。首次先发布 `master`；公共 `deployment-state.json` 与保存状态不一致时必须停止，从对应已发布 run 的 `github-pages` artifact 恢复，不得重构另一分支 HEAD 冒充已发布产物。
- Pages 只接收两环境静态构建产物，版本由 `version.json` 与全站 `deployment-state.json` 标识；操作及失败回滚边界见 `deploy/README.md`。自动化代码已实现不等于 IAM 授权或首次真实发布已完成。
- 本地 API 提供 `/healthz`、`/api/health`；聊天默认 `API_CHAT_MODE=mock`，配置 `deepseek` 与服务端 `DEEPSEEK_API_KEY` 后使用 SSE。部署仅以 `messages: []` 验证 400 / `INVALID_REQUEST`，不得在自动部署探针发送有效聊天或强制覆盖 Mock 模式；真实模型 smoke 独立显式执行。
- 浏览器 localStorage 对话保留 7 天、按环境命名空间区分，同源路径并非安全隔离；按序列化 UTF-8 大小计，达到 500 KiB 后停止继续对话，保留记录并提示清除，清空前必须确认；清空和取消生成遵循前端约定，不完整回复不进入模型历史。构建仅白名单读取根 `readme.md`、`docs/knowledge/affine.md` 与 `docs/knowledge/bytedance.md`，AFFiNE 仅加载第 1–6 节，字节跳动仅加载第 1–5 节，生成服务端公开知识 JS，不递归扫描文档或读取证据索引、归档提交 TSV、私人资料。模型用简历剔除项目经验中的旧版 ByteDance 段，避免内部名称、精确业务指标和宽泛职责重新进入上下文；根简历与前端展示不变，任职时间仍由简历提供。字节项目仅依据已脱敏知识库，技术参数、统计窗口和团队/个人边界按批准口径回答。知识版本覆盖三份实际模型输入，发布来源链接绑定发布提交。GitHub 固定公开仓库的 README 仅补充项目背景，绑定提交标注来源，固定快照不得冒称最新功能，项目整体能力不得扩写为个人职责；原始私人风格资料不得发布，仅提炼公开表达规则。日志只记录结构化状态、prompt / knowledge 版本、来源标识与耗时，不存正文或密钥。
- 修改后执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。本地构建不等于已发布；未经当前任务授权不更改线上服务。
