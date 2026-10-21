# 聊天日志

聊天服务分别保留运行元数据与自动过滤后的问答审计。问答审计用于排查和人工改进回答，不会自动写入知识库，也不会替代访客浏览器中的聊天记录。

## 保存范围

| 类型 | 内容 | 存放位置 |
| --- | --- | --- |
| 运行日志 | 请求 ID、状态、用量、耗时、版本及审计写入状态 | 本地 stdout；服务器 systemd journal |
| 问答审计 | 当前最后一条问题、服务端已接收的可见回答、关联元数据与截断标记 | 私有目录中的独立 JSON 文件 |

问答审计不重复保存请求携带的旧轮次，不保存完整 prompt、推理正文、原始上游错误正文或密钥。取消、超时和异常时，回答可能仅有一部分；`outcome` 和 `errorCode` 用于区分，不能把这些记录当成正常完成的回答。请求校验、限流等生成前拒绝的请求只记录运行元数据，不保存问题正文。

浏览器清空按钮只删除当前浏览器、当前环境的聊天记录，不删除服务端审计。页面在聊天时提示服务端保存与留存方式。审计目录不得加入 Git、Pages、API 发布包或公开下载目录；不要用包含正文的日志截图或云助手输出作为公开排障材料。

## 关联字段

- `id` 为本站请求 ID，与响应 `X-Request-Id` 和 SSE `meta.requestId` 对应；`upstreamId` 为 DeepSeek 响应中的请求 ID。`env`、`commit`、`promptVersion`、`knowledgeVersion`、`knowledgeRefs` 与 `repositoryRefs` 标识环境、代码和提供给模型的资料。
- `model` 为请求模型，`upstreamModel` 为供应商实际返回的模型标识；`thinkingEnabled`、`reasoningEffort` 记录思考设置。只保存思考首段的到达耗时，不保存推理文字。
- `promptTokens`、`completionTokens`、`cacheHitTokens`、`cacheMissTokens`、`reasoningTokens` 采用供应商返回值。推理 Token 是输出用量的细分，不要再次相加计算总量。`usageStatus` 为 `complete`、`partial`、`missing`，Mock 为 `not_applicable`；未知字段为 `null`，实际返回的零仍为 `0`。
- `timing` 为本站完整处理耗时，`firstToken` 为本站首次可见内容耗时；`upstreamDurationMs`、`firstReasoningMs`、`firstContentMs` 分别记录模型请求及首段推理、首段正文耗时，单位均为毫秒。`upstreamStatus` 为上游 HTTP 状态；HTTP 200 的 SSE 仍可能失败，必须结合 `outcome`、`errorCode`、`upstreamErrorCode` 查看。
- `auditStatus` 在运行日志中标识 `queued`、`stored`、`dropped`、`failed` 或 `disabled`；请求成功不代表审计一定写入成功。取消或断流时，供应商可能未发送最终 usage，不能从字符数估算成真实 Token 用量。

DeepSeek 字段依据[官方接口文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。平台 Usage 页面与导出文件为汇总用量，当前没有可依赖的逐请求导出关联键；以 API 响应中的 `upstreamId` 与 `usage` 记录本次调用，不能声称已与后台汇总逐条合并。共享 API Key 的开发和正式环境也不能仅靠后台汇总拆分。

## 自动过滤的边界

写文件前替换已配置的模型密钥，并按规则过滤常见 API Token、Bearer 凭据、密码字段、邮箱、手机号、身份证与长数字账号、IP 地址、URL 用户信息及查询参数、明确标注的姓名等。规则过滤会有漏报与误报，**不能保证完全匿名**，也不能识别所有自由文本中的公司机密、地址、姓名或业务信息。请勿输入敏感资料；人工查看或补充知识库前仍需复核。

只保存过滤后的当前问题与可见回答；不另留原文副本。问题上限约 8 KiB、回答上限约 20 KiB，按 JSON 编码字节预算截断，单条 JSON 不超过 32 KiB，`questionTruncated`、`answerTruncated` 标明截断。实际文件还包括元数据，超出单条或总容量限制的记录会丢弃。

## 配置与留存

| 配置 | 默认与范围 |
| --- | --- |
| `API_CHAT_AUDIT_ENABLED` | 非 test 的 DeepSeek 模式默认启用；Mock/test 默认关闭。可显式设置 `true` / `false` |
| `API_CHAT_AUDIT_DIR` | 绝对路径。正式 `/var/lib/resume/chat-audit`；开发部署 `/var/lib/resume-development/chat-audit`；本地 `<仓库>/.artifacts/chat-audit/local` |
| `API_CHAT_AUDIT_MAX_BYTES` | 每环境逻辑 JSON 容量 104857600 字节（100 MiB），可设 1–1073741824 字节 |
| `API_CHAT_AUDIT_RETENTION_DAYS` | 7，可设 1–7 天；容量淘汰可使实际保留时间更短 |

最多保存 10000 个审计文件。启动、每小时及写入前检查留存、容量与文件数，先删除过期记录，再按旧到新淘汰至可写入。容量只统计此专用目录中程序管理的 JSON 文件，不含文件系统元数据、journal 或 Nginx 日志。目录请专用，不混放其他资料；journald 仍受系统自身的容量配置管理，本功能没有更改服务器全局 journal 策略。

写入队列最多 32 项，积压时丢弃新审计，不阻塞回答。目录权限为 `0700`、文件为 `0600`；独立临时文件通过排他创建、同步后原子改名落盘，拒绝不安全的目录链接或文件。使用目录锁串行协调同一审计目录的写入；程序退出时有界等待刷新，异常退出或写盘失败仍可能丢失尚未落盘的记录。

## 排查与运维

通过内置浏览器的 ECS 云助手操作，先选定开发或正式环境；无需 SSH。运行状态先看对应 unit 的 journal，按 `id` 查关联事件；读取审计时仅筛选必要元数据，避免把问题、回答或密钥输出到命令历史、命令结果或公开材料。默认目录位于已有 systemd `StateDirectory`，与每次 release 目录分开，发布切换不会清除审计。

审计失败不会使聊天失败，需关注 `audit` 事件中的 `failed` / `dropped`。启动或定时清理失败也通过安全的 `audit` 事件报告，不包含原始错误信息或目录路径。持续失败时核对目录所有者、权限、空间与 `.lock`。异常退出可能留下锁；**确认没有任何进程正在写入该审计目录后**，才可人工清理失效锁。不能在运行中直接删除锁或放宽目录权限绕过保护。调整配置后重启目标环境服务，再用独立显式聊天 smoke 验证；自动部署探针不调用模型。

配置示例见 `apps/api/.env.example` 和 `deploy/resume.env.example`。本文件描述代码提供的能力，不作为线上已发布或实际已写入的证明。
