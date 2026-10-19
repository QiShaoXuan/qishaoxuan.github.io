# 简历网站

本仓库是简历网站后续开发、内容维护和部署配置的统一工作目录：

```text
/Users/bytedance/mygit/qishaoxuan.github.io
```

当前开发分支：`codex/resume-frontend`。

| 部分 | 位置与职责 |
| --- | --- |
| 简历前端 | GitHub Pages：`https://qishaoxuan.github.io/` |
| 聊天接口 | ECS：`https://101.201.78.159/api/chat`，接口尚待实现 |
| ECS 健康检查 | `https://101.201.78.159/healthz` |
| 最新简历源 | [resume.md](resume.md)，作为简历内容的主要依据 |
| 服务与证书部署配置 | [deploy/README.md](deploy/README.md) |

## 本地生成和预览

```bash
npm ci
npm run md2html
python3 -m http.server 8080 --bind 127.0.0.1
```

预览生成的简历：`http://127.0.0.1:8080/resume.html`。`md2html.js` 固定读取本仓库的 `resume.md`，输出本仓库的 `resume.html`。本次迁移保留既有依赖版本，没有引入前端框架或部署流水线；原 `index.html` 暂时保留为项目导航页，后续开发时再替换为正式简历前端。

## 内容和私有资料

- [resume.md](resume.md)：最新简历，优先于旧 HTML、旧 PDF 及工作经历底稿。
- [content/work-experience/gigacre-work.md](content/work-experience/gigacre-work.md)：早期工作经历补充材料，不作为最新事实的覆盖来源。
- `archive/resume-2023/`：2023 年旧 PDF，仅作历史留存，不接入当前简历下载入口。
- `private/`：本机聊天风格原始报告及个人求职资料，已加入 `.gitignore`。不要提交、上传或打包到静态部署产物；后续按公开范围提取服务端角色设定。

所有后续前端、聊天服务代码及部署维护均在本仓库中进行。模型密钥和证书私钥继续仅保存在服务器；前端通过 HTTPS 调用 ECS。接入时，API 的 CORS 应允许 `https://qishaoxuan.github.io` 并处理预检；CORS 不替代接口鉴权和限流。

GitHub Pages 后续只发布明确的前端静态构建产物，不把仓库整个工作目录（包括 `private/`、部署脚本和服务端资料）作为发布产物。

迁移清单及当前状态见 [docs/migration.md](docs/migration.md)。

## 原主页项目列表

以下保留原仓库的导航资料。

语言和框架只是实现目标的一个工具和手段。

君子役物，小人役于物。

这里用来记录写过的小玩意儿，以防自己都忘记。

1. [css_tricks](https://github.com/QiShaoXuan/css_tricks)

2. [js_tricks](https://github.com/QiShaoXuan/js_tricks)

3. [blog](https://github.com/QiShaoXuan/blog)

4. [animate_resume_ts](https://github.com/QiShaoXuan/animate_resume_ts)

5. [wavejs](https://github.com/QiShaoXuan/wavejs)

6. [rhythm-ripple](https://github.com/QiShaoXuan/rhythm-ripple)

7. [dont-touch-white](https://github.com/QiShaoXuan/dont-touch-white)

8. [log-tree](https://github.com/QiShaoXuan/log-tree)

9. [log-dir-tree](https://github.com/QiShaoXuan/log-dir-tree)

10. [PAnimate](https://github.com/QiShaoXuan/PAnimate)

11. [bundle_email_template](https://github.com/QiShaoXuan/bundle_email_template)

12. [pazzle](https://github.com/QiShaoXuan/pazzle)

13. [particleText](https://github.com/QiShaoXuan/particleText)

14. [vue_tetris](https://github.com/QiShaoXuan/vue_tetris)

15. [messyBalls](https://qishaoxuan.github.io/messyBalls/)

