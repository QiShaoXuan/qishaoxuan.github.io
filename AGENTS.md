# 项目约定

- 使用中文沟通。后续简历前端、聊天服务、内容和部署配置统一在本仓库维护，不依赖旧 `/Users/bytedance/mygit/resume` 工作目录。
- 最新简历事实以根目录 `resume.md` 为主；`resume.html` 通过 `npm run md2html` 生成。`archive/resume-2023/` 的 PDF 和 `content/work-experience/` 底稿不能覆盖最新简历。
- 前端目标是现有 GitHub Pages `https://qishaoxuan.github.io/`；聊天接口继续使用 ECS `https://101.201.78.159/api/chat`。当前 ECS 仍是环境准备维护服务，聊天接口尚未实现。
- `private/` 仅供本地整理原始聊天风格和私人求职资料，已被 Git 忽略；不得提交、上传或打包进公开静态产物。需先整理允许公开回答的内容，再接入服务端。
- 模型密钥、SSH 私钥和 TLS 私钥不进入前端或 Git；ECS 配置与验证记录见 `deploy/README.md`。
- GitHub Pages 只发布明确的前端静态构建产物，不直接发布整个工作目录。跨域来源是 `https://qishaoxuan.github.io`，不含路径。
- 迁移阶段保留原 `index.html` 导航页；前端框架和正式发布流水线尚待后续开发确定。
