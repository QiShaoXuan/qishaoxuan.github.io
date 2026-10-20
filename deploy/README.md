# 简历网站部署环境

统一工作仓库：`/Users/bytedance/mygit/qishaoxuan.github.io`。前端使用 GitHub Pages，聊天接口继续部署在下述 ECS；前后端代码、内容及部署配置后续均在本仓库维护。前端使用 React + TypeScript + Vite，后端使用 Node.js + TypeScript + Fastify；GitHub Pages 只接收两环境 `apps/web/dist/` 合并后的静态产物与公开版本元数据。

目标服务器：阿里云北京 ECS `101.201.78.159`，Ubuntu 24.04，2 核 2GB。

采用 Node.js 24 LTS + Nginx + systemd。网站应用以普通用户 `resume` 运行，仅监听 `127.0.0.1:3000`。Nginx 提供公网入口；`/api/chat` 关闭响应缓冲，预留 SSE 流式回复。未安装 Docker、PM2 或数据库。

## 环境准备验证记录（2026-10-19）

- Node `24.22.0`、npm `11.19.1`、Ubuntu 仓库 Nginx `1.24.0-2ubuntu7.18`；官方 Node 发行包 SHA256 校验通过。
- `resume` 专用公钥登录成功；sudo 仅授权重启 `resume.service`。运行进程用户确认是 `resume`。
- Nginx 与应用均已启用开机启动；主动终止应用进程后，systemd 自动重启，代理健康检查恢复 200。未为验证额外重启整台服务器。
- 首次 HTTP 部署阶段，本机通过公网直连 `/healthz` 返回 200；首页维护响应 503；公网 3000 连接失败，服务器确认仅回环地址监听 3000。启用 HTTPS 后的验证见下节；真实聊天 SSE 尚待应用实现后验证。
- 修正 Nginx 异步重载的健康检查等待后，完整安装脚本重复执行通过，原有 Swap、当前应用链接及环境变量文件保留。最近配置备份：`/var/backups/resume-bootstrap/20261019T121337-3955/`。

## 首次安装

将 `deploy` 目录及管理员**公钥**复制到服务器，以 root 执行：

```bash
bash /path/to/deploy/bootstrap.sh /path/to/admin-key.pub
```

默认固定 Node `24.22.0`，从 Node 官方下载并实际验证 SHA256。脚本保留已有 Swap、SSH 服务配置和应用发布目录；修改前备份配置到 `/var/backups/resume-bootstrap/`。首次运行会建立维护页，首页 HTTP 503，`/healthz` HTTP 200。维护页不是实际简历网站，也不调用模型。

脚本可重复执行，但会更新本项目的 systemd、部署账户密钥授权和重启权限。未安装 IP 证书时会更新 HTTP 代理配置，检测到 `resume-ip` 证书后保留已有 HTTPS 配置。每次执行都会重启本项目服务，不会自动回滚包安装或失败的配置写入；先在当前服务器检查无同名资源冲突。安装阶段会移除 Ubuntu 默认站点的启用软链接。

## 配置 IP HTTPS 与续期

2026-10-19 已完成配置并验证：

- 正式 Let's Encrypt 证书包含 IP SAN `101.201.78.159`，签发者 `YE1`；当时证书到期时间为北京时间 **2026-10-26 11:12:31**，实时到期时间随自动续期更新。
- 本机系统 curl 使用默认信任库验证通过；Python 使用现有 certifi 可信 CA 库验证通过，IP 匹配且协商 TLS 1.3。公网 HTTPS `/healthz` 返回 200，首页仍为维护状态 503；HTTP 自动跳转 HTTPS。
- `renew --dry-run --run-deploy-hooks` 成功，验证了挑战文件及 Nginx 重载；正式续期 service 也已手动执行，退出状态为 `0/SUCCESS`。
- timer 已启用并等待执行；2026-10-19 核验时下次检查为北京时间 `2026-10-20 00:08:57`；当前计划以 `systemctl list-timers` 为准。本次 HTTPS 配置备份位于 `/var/backups/resume-https/20261019T121054-3784/`。
- 启用 HTTPS 后再次完整执行 bootstrap 通过，代理配置 SHA256 未变化；证书私钥权限为 root:root 600，系统无失败服务。

本项目提供 `101.201.78.159` 的 IP 证书配置，不需要购买域名。完成首次环境安装后，以 root 执行：

```bash
bash /path/to/deploy/setup-ip-https.sh
```

脚本使用官方 PyPI 的 Certbot 5.8.0，隔离安装在 `/opt/certbot`。通过 webroot 申请 Let's Encrypt `shortlived` ECDSA 证书，明确要求该 profile，避免回退。证书签发和 ACME 账户私钥只在服务器 `/etc/letsencrypt/` 中保存；不登记个人邮箱。

80 端口保留 `/.well-known/acme-challenge/` 的文件验证，其余请求跳转到 `https://101.201.78.159`；443 使用 IP 证书提供 TLS 1.2/1.3。部署前备份 Nginx 配置，校验或重载失败会恢复原配置。证书配置路径固定为：

```text
/etc/letsencrypt/live/resume-ip/fullchain.pem
/etc/letsencrypt/live/resume-ip/privkey.pem
```

IP 证书有效期约 160 小时。`resume-certbot-renew.timer` 每天 00、06、12、18 点（服务器 Asia/Shanghai 时区）检查，加最多 30 分钟随机延迟；错过的任务开机补跑。仅在 Certbot 判定需要时续期，不强制频繁签发。续期成功后，root 所有的 deploy hook 执行 `nginx -t` 并 reload，使新证书生效，无需重启应用。

```bash
systemctl status resume-certbot-renew.timer --no-pager
systemctl list-timers resume-certbot-renew.timer --no-pager
journalctl -u resume-certbot-renew.service -n 50 --no-pager
/opt/certbot/bin/certbot renew --cert-name resume-ip --dry-run --run-deploy-hooks
```

dry-run 使用测试 CA 验证续期，并用当前正式证书执行 deploy hook，不替换线上证书。`renew` 会复用保存的 IP、webroot 和 shortlived profile。该任务使用自定义 systemd timer，因此无需再叠加 cron、snap 或 apt 版本的重复续期任务。service 是 oneshot，执行成功后显示 inactive 属正常状态，timer 应保持 active (waiting)。无邮箱注册也意味着没有个人邮箱通知；续期失败可通过上述服务日志定位。

Certbot 客户端定期维护更新，更新后再做续期演练：

```bash
/opt/certbot/bin/python -m pip install --index-url https://pypi.org/simple --upgrade certbot
/opt/certbot/bin/certbot renew --cert-name resume-ip --dry-run --run-deploy-hooks
```

参考：[Let's Encrypt IP 证书与 Certbot](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)、[Certbot 官方 pip 安装](https://certbot.eff.org/instructions?os=pip&ws=other)。

## 初始正式环境目录与权限（历史记录）

| 路径 | 用途 |
| --- | --- |
| `/srv/resume/releases/<版本>/` | 各次构建产物，由 `resume` 管理 |
| `/srv/resume/current` | 当前版本软链接 |
| `/srv/resume/shared` | 应用持久文件，当前无业务数据 |
| `/etc/resume/resume.env` | 服务端环境变量，root 所有，resume 可读，权限 640 |
| `/etc/systemd/system/resume.service` | 开机自启、失败重启、内存限制 |
| `/etc/nginx/sites-available/resume` | 反向代理与访问日志格式 |

`resume` 无普通 sudo 权限，仅允许 `sudo /usr/bin/systemctl restart resume.service`。应用不以 root 运行，设置 1GB 内存上限、640MB Node 堆上限。服务器原有 4GB Swap 保留；构建建议在本机或 CI 完成，避免挤占小内存服务器。

应用 stdout/stderr 交给 journald。Nginx access log 不记录 IP、查询参数、请求体和 User-Agent；应用实现也须避免打印聊天正文、密钥及用户资料。Nginx error log 为 warn，故障时仍可能包含请求 URI、来源等诊断信息，不应把聊天内容放入 URL。

## 云助手管理与检查

后续服务器管理、部署与排障统一使用云助手，不再使用 SSH / SCP。入口：[ECS 云助手，北京地域](https://ecs.console.aliyun.com/cloud-assistant/region/cn-beijing/server)。

1. 选择公网 IP 为 `101.201.78.159` 的实例，确认云助手状态正常。
2. 创建 Shell 命令，应用操作选择执行用户 `resume`、执行路径 `/srv/resume`；发布任务超时可设为 300 秒。
3. 执行后查看输出和退出码，并核验接口或服务状态。日常检查命令如下：

```bash
systemctl status resume.service --no-pager
curl --fail http://127.0.0.1:3000/healthz
curl --fail --resolve 101.201.78.159:443:127.0.0.1 https://101.201.78.159/healthz
```

需要查看受限日志或管理 Nginx 等系统级操作时，在对应任务已授权的范围内选择 `root` 用户执行：

```bash
journalctl -u resume.service -n 100 --no-pager
tail -n 50 /var/log/nginx/resume.error.log
nginx -t
systemctl reload nginx.service
```

历史安全组记录中 22 端口来源为 `211.95.64.140/32`，80/443 对公网开放，保留 ICMP。双环境应用公共入口只需 80/443，3000、3100 及预检端口仅绑定回环地址，不新增公网安全组规则。后续运维使用云助手，不再随本机出口 IP 变化调整 SSH 白名单。

## 双环境自动部署

双环境自动化代码已实现；外部 IAM/OIDC 授权、GitHub Environments 设置、首次真实发布与公网验证尚待完成。本文此前 2026-10-19 的记录属于原环境准备阶段，不代表新流程已运行成功。

| 项目 | 正式环境 | 开发环境 |
| --- | --- | --- |
| 分支 / GitHub Environment | `master` / `production` | `develop` / `development` |
| Pages | `https://qishaoxuan.github.io/` | `https://qishaoxuan.github.io/dev/` |
| 公网 API | `https://101.201.78.159/api` | `https://101.201.78.159/dev/api` |
| 用户 / systemd | `resume` / `resume.service` | `resume-dev` / `resume-development.service` |
| 发布根 / 服务 / 预检端口 | `/srv/resume` / 3000 / 3001 | `/srv/resume-development` / 3100 / 3101 |

两套服务均以普通用户运行、`NODE_ENV=production`，监听 `127.0.0.1`。Nginx 将 `/dev/api/` 去掉 `/dev` 前缀后代理到 3100；正式 API 代理到 3000。浏览器两环境的 Origin 都是 `https://qishaoxuan.github.io`，CORS 不带 `/dev` 路径。公共端口仅需 80/443；服务和预检端口不开放公网。

### 一次性初始化

1. 保留现有正式服务、IP HTTPS 与自动续期配置。通过云助手以 `root` 传送并运行当前完整 `deploy/` 中的初始化脚本：

   ```bash
   bash /path/to/deploy/setup-environments.sh
   ```

   脚本依赖同目录的两份 service、HTTPS Nginx 配置和 `readiness/server.js`，不要只传单个脚本。它建立 `resume-dev` 用户、开发目录与环境文件、开发维护服务及各用户仅重启自身 unit 的 sudo 权限，备份配置后校验并更新 Nginx；失败时恢复配置，既有正式进程和 TLS 续期保留。新建用户、目录等资源不保证全部删除。首次开发发布前 `/dev/healthz` 可用于维护健康检查，其余业务接口仍需发布后可用。
2. 在阿里云配置 GitHub OIDC provider（audience `sts.aliyuncs.com`）和两个 RAM 角色，信任分别绑定本仓库 `production`、`development` Environment 的 OIDC subject。角色授权仅覆盖目标实例的云助手 `RunCommand` 与调用结果查询；执行用户名分别限制为 `resume`、`resume-dev`，不能用 `root`，不能跨环境切换用户。实例所属地域为 `cn-beijing`。
3. 在 GitHub 创建 `production`、`development` Environments，允许部署分支分别限制为 `master`、`develop`。每个 Environment 添加变量 `ECS_INSTANCE_ID`、`ALIYUN_ROLE_ARN`、`ALIYUN_OIDC_PROVIDER_ARN`；两个角色 ARN 分别填写，实例与 provider 可相同。不配置长期 AccessKey 或 SSH 私钥。
4. 将仓库 Pages 来源设为 GitHub Actions。首次先运行 `master`，建立根站点与 `pages-state`；正式发布验证完成后再运行 `develop`。

### 自动发布顺序

`.github/workflows/pages.yml` 对 `master`、`develop` 的 PR 执行检查，不发布；两分支 push 或在该分支手动运行时，检查通过后自动发布。先拒绝已落后于对应远程分支 HEAD 的运行，再在全局 `resume-release` 并发组中串行执行完整 release，避免两分支互相覆盖 Pages。

1. 执行 `npm ci`、Lint、类型检查、测试，按目标构建前端：正式 base `/`、API base `https://101.201.78.159`；开发 base `/dev/`、API base `https://101.201.78.159/dev`。
2. `npm run package:api -- prod "$(git rev-parse HEAD)"`（开发改为 `dev`）编译 API，生成 `.artifacts/api-release.tgz`：平铺 JS、最小运行清单、独立生产锁、`version.json`、`release.env`。后两项保存 `commit` / `environment` 及 `RELEASE_COMMIT` / `DEPLOY_ENV`；不含依赖目录、开发工具、原始私人资料或密钥。
3. 校验 `pages-state` 与公网 `deployment-state.json` 一致，再从已保存的静态产物构造完整 Pages 包，仅替换本次环境，不重构另一分支。OIDC 获取临时凭证后，`scripts/cloud-assistant.mjs` 按环境普通用户分块传包、核验 SHA256、安全解压，在新 release 内 `npm ci --omit=dev --ignore-scripts`，运行激活脚本。
4. 激活脚本在本环境预检端口验证 commit、environment、健康、Mock 200 与 CORS，切换 `current` 后重启对应 unit，再验证运行端口。云助手脚本另核验公网健康、Mock 与预检。API 成功后才发布完整 Pages artifact。
5. Pages 发布后轮询公网 generation，确认本次发布后才将完整静态站点及元数据提交到 `pages-state`。此分支不是源码分支，不触发新的应用发布。

云助手发布创建的版本目录为 `<发布根>/releases/<commit>-<run_id>-<run_attempt>/`；systemd 读取全局环境文件和当前版本 `release.env`，无需在线编译 TypeScript。手动排障时，激活脚本的完整调用形式为：

```bash
bash /path/to/deploy/activate-api.sh prod '/srv/resume/releases/<版本>' '<40位commit>'
# 开发环境由 resume-dev 执行：
bash /path/to/deploy/activate-api.sh dev '/srv/resume-development/releases/<版本>' '<40位commit>'
```

正式环境变量文件为 `/etc/resume/resume.env`，开发为 `/etc/resume-development/resume.env`；两套保留 `NODE_ENV=production` 和 `API_ALLOWED_ORIGINS=https://qishaoxuan.github.io`。不要把本地 `.env` 的 localhost 来源复制到服务器。`DEPLOY_ENV=dev` 标识已部署的开发环境，不代表 Node 开发模式。

### 公网检查与失败边界

```bash
curl --fail https://101.201.78.159/api/health
curl --fail https://101.201.78.159/dev/api/health
curl --fail https://qishaoxuan.github.io/deployment-state.json
curl --fail https://qishaoxuan.github.io/version.json
curl --fail https://qishaoxuan.github.io/dev/version.json
```

API 健康结果除 `status: "ok"`、`service: "resume-api"`，还应包含所发布的 40 位 `commit` 和 `environment: "prod"|"dev"`。Pages 整站状态记录 `generation: "<run_id>-<run_attempt>"` 及两环境 commit；各路径 `version.json` 记录本环境最后一次更新的 commit、environment、generation，未更新环境的 generation 可保持旧值。

简历页面与聊天面板已实现。合法 `POST /api/chat`（开发为 `/dev/api/chat`）返回 HTTP 200 和 `{ mode: "mock", message: { role: "assistant", content: string } }`。固定内容为“这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。”；不调用模型、不回显用户内容、不读取 `private/`。浏览器还需分别验证两前端路径的聊天请求路由及异常提示。

- API 预检失败时不切换运行版本；切换后的健康或路由验证失败时，激活脚本恢复旧链接并重启。回滚本身失败会明确报错，需云助手检查对应 unit。
- API 已激活但公网检查或 Pages 发布失败时，不自动回滚 API；旧前端仍保留。前后端接口需保持兼容，再修复并从当前分支 HEAD 重试。
- Pages 已发布但 generation 验证或 `pages-state` 保存失败时，公网可能已经更新；下次 guard 会拒绝不一致状态。先执行下节状态恢复，禁止直接重跑去覆盖另一环境。
- Pages 与 API 不是跨平台事务；另一个环境的静态产物来自最近成功保存的状态，不保证其 API 在故障前后自动回滚。

API 仅信任回环代理传递的客户端地址，Nginx 覆盖 `X-Forwarded-For`；Mock 聊天默认每 IP 每分钟 10 次，健康和预检不计入额度，计数在单进程内存中。API 不记录聊天正文；真实模型以后接入时再增加服务端密钥、总预算与并发控制。

### 恢复已发布 Pages 状态

仅在公网已发布产物与 `pages-state` 不一致时使用。恢复的是当前公网 generation 对应运行上传的 **`github-pages` artifact**，不是 `release-<sha>`、另一分支源码或重新构建产物。先暂停人工触发和分支推送发布，确认没有 release 正在执行；恢复期间若有新发布，下面的 guard 必须失败并重新核对。

在仓库根目录的 Bash 中，使用已登录且有仓库内容写权限的 `gh`，执行（任一命令失败即停止，不继续下一段）：

```bash
set -euo pipefail
RECOVERY_ROOT=$(mktemp -d /tmp/resume-pages-recovery.XXXXXX)
RECOVERY_REPO=QiShaoXuan/qishaoxuan.github.io
curl --fail --silent --show-error -H 'Cache-Control: no-cache'   "https://qishaoxuan.github.io/deployment-state.json?recovery=$(date +%s)"   > "$RECOVERY_ROOT/published.json"
RECOVERY_GENERATION=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).generation' "$RECOVERY_ROOT/published.json")
RECOVERY_RUN_ID=${RECOVERY_GENERATION%-*}
RECOVERY_ATTEMPT=${RECOVERY_GENERATION##*-}
gh run view "$RECOVERY_RUN_ID" --attempt "$RECOVERY_ATTEMPT" --repo "$RECOVERY_REPO"
gh run download "$RECOVERY_RUN_ID" --repo "$RECOVERY_REPO"   --name github-pages --dir "$RECOVERY_ROOT/download"
mkdir "$RECOVERY_ROOT/site"
tar -xf "$RECOVERY_ROOT/download/artifact.tar" -C "$RECOVERY_ROOT/site"
node -e 'const fs=require("node:fs"); const a=JSON.parse(fs.readFileSync(process.argv[1])); const b=JSON.parse(fs.readFileSync(process.argv[2])); if(a.generation!==b.generation || JSON.stringify(a.environments)!==JSON.stringify(b.environments)) process.exit(1)'   "$RECOVERY_ROOT/published.json" "$RECOVERY_ROOT/site/deployment-state.json"
node scripts/pages-state.mjs guard https://qishaoxuan.github.io "$RECOVERY_ROOT/site"
```

必须确认 generation 对应的 run 与 attempt 已完成 Pages 发布；完整 workflow 可能因为随后保存状态失败而显示失败。若 artifact 已过期、同名 artifact 不唯一、元数据不一致或无法取得公网状态，停止恢复；不能用重新构建代替。

确认 artifact 与公网一致后，将其原样写入状态分支。下列命令不使用 force push：

```bash
RECOVERY_STATE_RESULT=0
git ls-remote --exit-code --heads origin pages-state || RECOVERY_STATE_RESULT=$?
if [ "$RECOVERY_STATE_RESULT" = 0 ]; then
  git fetch origin refs/heads/pages-state:refs/remotes/origin/pages-state
  git worktree add --detach "$RECOVERY_ROOT/state" origin/pages-state
elif [ "$RECOVERY_STATE_RESULT" = 2 ]; then
  git worktree add --detach "$RECOVERY_ROOT/state" HEAD
  git -C "$RECOVERY_ROOT/state" switch --orphan pages-state
else
  echo "Cannot query pages-state; stop recovery." >&2
  exit "$RECOVERY_STATE_RESULT"
fi
git -C "$RECOVERY_ROOT/state" rm -r --ignore-unmatch .
cp -a "$RECOVERY_ROOT/site/." "$RECOVERY_ROOT/state/"
node scripts/pages-state.mjs guard https://qishaoxuan.github.io "$RECOVERY_ROOT/state"
git -C "$RECOVERY_ROOT/state" add -A
git -C "$RECOVERY_ROOT/state" commit -m "Recover published Pages state $RECOVERY_GENERATION"
git -C "$RECOVERY_ROOT/state" push origin HEAD:refs/heads/pages-state
```

推送完成后再次运行 `node scripts/pages-state.mjs guard https://qishaoxuan.github.io "$RECOVERY_ROOT/state"`；通过后再恢复正常发布。保留恢复目录用于审查，处理完成后可 `git worktree remove "$RECOVERY_ROOT/state"` 清理 worktree。若恢复推送冲突，重新读取最新公网与远程状态，不能强制覆盖。

## 后续范围

当前保留 Mock，真实模型与 SSE 不属于双环境部署任务。后续按公开范围提炼角色设定、配置服务端密钥与预算，并继续验证日志隐私。自有域名不是当前 IP HTTPS 的前置条件。

参考：[Node 官方下载](https://nodejs.org/en/download)、[Nginx 代理缓冲](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。
