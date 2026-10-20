# 简历网站部署环境

统一工作仓库：`/Users/bytedance/mygit/qishaoxuan.github.io`。前端使用 GitHub Pages，聊天接口继续部署在下述 ECS；前后端代码、内容及部署配置后续均在本仓库维护。前端使用 React + TypeScript + Vite，后端使用 Node.js + TypeScript + Fastify；GitHub Pages 只接收 `apps/web/dist/` 静态产物。

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

## 目录与权限

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

## 连接与检查

本机专用私钥：`/Users/bytedance/.ssh/aliyun_resume_beijing`，不能上传或提交仓库。公钥已授权 root 和 resume。主机公钥保存在本机 `/Users/bytedance/.ssh/known_hosts_aliyun_resume`。

```bash
ssh -F /dev/null -i ~/.ssh/aliyun_resume_beijing \
  -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=~/.ssh/known_hosts_aliyun_resume \
  resume@101.201.78.159

systemctl status resume.service --no-pager
curl --fail http://127.0.0.1:3000/healthz
curl --fail --resolve 101.201.78.159:443:127.0.0.1 https://101.201.78.159/healthz
```

root 可查看完整日志及管理代理：

```bash
journalctl -u resume.service -n 100 --no-pager
tail -n 50 /var/log/nginx/resume.error.log
nginx -t
systemctl reload nginx.service
```

安全组只允许当前管理出口 `211.95.64.140/32` 访问 22，80/443 对公网开放，保留 ICMP。出口 IP 改变后须在阿里云控制台更新 SSH 白名单，禁止为了方便直接长期开放全部端口。

## 发布前后端基础架构

以下流程用于发布连接检查页、最小 Mock 聊天联调表单与 API 基础接口；合法聊天请求返回 HTTP 200 的固定 Mock 回复，尚无模型调用或 SSE。线上是否更新，以本次发布后的实际检查为准；前述 2026-10-19 记录对应环境准备阶段。

### GitHub Pages

`.github/workflows/pages.yml` 在推送 `master` 后执行类型检查、Lint、测试和构建，且仅上传 `apps/web/dist/`。仓库 Pages 来源应设为 GitHub Actions。此次发布会将现有主页替换为前后端连接检查页及 Mock 聊天联调表单，正式简历与完整聊天界面尚待后续实现。

本地可执行 `npm ci`、`npm run build:web` 检查产物。Vite 生产构建默认请求 `https://101.201.78.159`，需要覆盖时在构建前注入 `VITE_API_BASE_URL`；所有 `VITE_` 值都属于公开内容。不要将仓库根目录、`private/`、API 或部署配置作为 Pages 产物。

### ECS API

在 Node 24 / npm 11 环境执行：

```bash
npm ci
npm run package:api
```

脚本先编译 API，再生成 `.artifacts/api-release.tgz`。压缩包包含平铺后的 `apps/api/dist/*.js`、最小运行 `package.json` 和基于 `deploy/api-package-lock.json` 的独立生产锁文件；不包含 `node_modules/`、开发工具、私人资料或密钥。仓库根锁文件包含 workspaces，不能替代这个独立生产锁。

以 `resume` 将压缩包上传并解压到一个新的 `/srv/resume/releases/<版本>/` 目录，在该目录运行：

```bash
npm ci --omit=dev --ignore-scripts
```

运行依赖在服务器依据锁文件安装，不在小内存 ECS 上执行 TypeScript 编译。发布目录布局为：

```text
/srv/resume/releases/<版本>/
  server.js
  app.js
  config.js
  package.json
  package-lock.json
  node_modules/
```

JS 文件平铺在版本目录根部，以匹配现有 unit 的 `/srv/resume/current/server.js`。保留旧发布目录用于回滚，不要覆盖当前运行版本。

systemd 从 `/etc/resume/resume.env` 注入运行环境。保留 `NODE_ENV=production`、`HOSTNAME=127.0.0.1`、`PORT=3000`，并设置 `API_ALLOWED_ORIGINS=https://qishaoxuan.github.io`。不要把开发 `.env` 的 localhost 来源复制到生产。API 默认也仅允许这个 Pages origin，处理 OPTIONS 预检；无 Origin 的服务端请求可以访问，CORS 不替代鉴权。

准备完依赖后，通过部署脚本激活新版本：

```bash
bash /path/to/deploy/activate-api.sh /srv/resume/releases/<版本>
```

脚本先在本机 3001 端口预检候选版本的健康接口与 Mock 聊天（HTTP 200、`mode: "mock"`），再原子切换 `/srv/resume/current` 并重启 `resume.service`；切换后健康检查失败会自动恢复旧链接并重启。执行前确保 3001 未被其他服务占用，并保留旧链接目标。发布后仍需通过公网 HTTPS 和 Pages 浏览器实际检查，不能仅凭进程启动认定上线成功。

```bash
curl --fail https://101.201.78.159/healthz
curl --fail https://101.201.78.159/api/health
```

两项应返回 `{"status":"ok","service":"resume-api"}`；浏览器连接检查也应显示 `resume-api`。合法聊天请求应返回 HTTP 200 和 `{ mode: "mock", message: { role: "assistant", content: string } }`。固定内容为“这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。”；不调用模型、不回显用户内容、不读取 `private/`。

API 仅信任回环代理传递的客户端地址，配合现有 Nginx 覆盖 `X-Forwarded-For`；聊天限流是单进程内存计数，默认每 IP 每分钟 10 次，健康检查和预检不消耗额度。当前没有模型密钥配置项；后续接入模型时只在服务端环境文件保存密钥，并补充预算控制。API 关闭请求日志，不打印消息正文。

## 上线前仍需完成

1. 基础链路上线验证后，基于根目录 `readme.md` 实现正式简历展示与聊天界面。
2. 当前保留 Mock；后续接入真实模型时，再配置服务端密钥、总额度与并发控制。
3. 验证简历页面、真实 SSE、异常提示及日志隐私；配置必要的备份与监控。
4. 如后续选用自有域名，再配置域名证书、DNS 及对应接入手续；IP HTTPS 不要求购买域名。

参考：[Node 官方下载](https://nodejs.org/en/download)、[Nginx 代理缓冲](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。
