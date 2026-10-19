# 简历网站部署环境

统一工作仓库：`/Users/bytedance/mygit/qishaoxuan.github.io`。前端使用 GitHub Pages，聊天接口继续部署在下述 ECS；前后端代码、内容及部署配置后续均在本仓库维护。本文中的 Next.js standalone 发布说明仅适用于选择在 ECS 运行的服务部分，GitHub Pages 只接收前端静态构建产物。

目标服务器：阿里云北京 ECS `101.201.78.159`，Ubuntu 24.04，2 核 2GB。

采用 Node.js 24 LTS + Nginx + systemd。网站应用以普通用户 `resume` 运行，仅监听 `127.0.0.1:3000`。Nginx 提供公网入口；`/api/chat` 关闭响应缓冲，预留 SSE 流式回复。未安装 Docker、PM2 或数据库。

## 已验证状态（2026-10-19）

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

- 正式 Let's Encrypt 证书包含 IP SAN `101.201.78.159`，签发者 `YE1`；当前证书到期时间为北京时间 **2026-10-26 11:12:31**，后续随自动续期更新。
- 本机系统 curl 使用默认信任库验证通过；Python 使用现有 certifi 可信 CA 库验证通过，IP 匹配且协商 TLS 1.3。公网 HTTPS `/healthz` 返回 200，首页仍为维护状态 503；HTTP 自动跳转 HTTPS。
- `renew --dry-run --run-deploy-hooks` 成功，验证了挑战文件及 Nginx 重载；正式续期 service 也已手动执行，退出状态为 `0/SUCCESS`。
- timer 已启用并等待执行；核验时下次检查为北京时间 `2026-10-20 00:08:57`。本次 HTTPS 配置备份位于 `/var/backups/resume-https/20261019T121054-3784/`。
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

## 后续发布应用

如果前端使用 GitHub Pages，前端须构建为纯静态文件；聊天 `/api/chat` 仍运行在 ECS。Pages 的实际 origin 确定后，再为 API 配置 CORS 与 OPTIONS 预检。HTTPS 本身不会自动解决跨域问题。

应用尚未实现，因此当前不能执行网站构建。如果继续在 ECS 运行 Next.js 服务，开启 `output: 'standalone'`，在 Linux x64 的构建环境使用相同 Node 大版本构建；涉及原生依赖时，不能直接上传 macOS 构建产物。

每个版本目录须含 `server.js`、standalone 依赖、`public/`（项目存在时）、`.next/static/`。运行环境从 `/etc/resume/resume.env` 注入。模型密钥只填在服务器该文件中，禁止使用 `NEXT_PUBLIC_` 前缀或放入前端产物。Next.js 构建时读取的变量需在 CI 单独管理，运行时文件不会补充构建时变量。

以 `resume` 上传准备好的版本，例如 `/srv/resume/releases/20261019-001/`；记录旧链接目标后，原子切换并重启：

```bash
cd /srv/resume
readlink current
ln -s /srv/resume/releases/20261019-001 .current-next
mv -Tf .current-next current
sudo /usr/bin/systemctl restart resume.service
```

验证应用健康检查和真实聊天响应；应用需要继续提供 `/healthz`。失败时将链接切回刚才记录的旧版本并重启。删除旧版本前确认它不是当前运行版本。首次上线前需根据实际应用内存占用复核 1GB 服务限制。

## 上线前仍需完成

1. 实现并发布简历网站；采用 GitHub Pages 时，配置静态构建与 API 跨域访问。
2. 配置模型 API 密钥、额度和聊天限流。
3. 验证简历页面、真实 SSE、异常提示及日志隐私；配置必要的备份与监控。
4. 如后续选用自有域名，再配置域名证书、DNS 及对应接入手续；IP HTTPS 不要求购买域名。

参考：[Node 官方下载](https://nodejs.org/en/download)、[Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)、[Nginx 代理缓冲](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。
