# Design

## Source of truth

Status: Active。日期：2026-10-20。范围：React 简历网页、浮动聊天窗与左右停靠侧栏。

- 内容唯一来源：根目录 `readme.md`，完整保留事实、数字、链接和工作经历；不读取 `private/`。
- 视觉来源：Kami `0b9433633616318349d3da87c06e690a4d8f5b25` 的中文 `assets/templates/resume.html`、`CHEATSHEET.md` 与 `references/design.md`。
- 最新排版参考：[demo-musk-resume.pdf](https://kami.tw93.fun/assets/demos/demo-musk-resume.pdf) 两页的紧凑块间距和行距；字体按用户明确要求改为苹方。
- AI 界面来源：Beautiful UI 官方 `slev12397/beautiful-ui@44a274e598395ab61e7c96c26fda2758780253b7` 的 ThinkingState / ChatComposer。
- 图标：官方 `@heroicons/react`，统一 outline 风格。
- 用户已确认：停靠左 / 右时变为全高侧栏，为简历让出空间，正文随之缩窄。

## Brand

温暖、克制、可信、重阅读。采用 Kami 暖纸色、墨蓝色和紧凑层级，字体使用用户指定的苹方；不增加装饰卡片、虚构头像、指标或职位。

## Product goals

浏览完整简历、快速定位公司与项目、在不离开简历的情况下打开聊天。聊天保持 Mock，界面明确标记演示状态。

验收：简历内容覆盖完整，浮窗可拖、左右可停靠、可恢复悬浮，侧栏不覆盖正文；移动端不溢出；Mock 正常发送与重试。

## Personas and jobs

招聘人员与技术面试官在电脑或手机阅读履历；关注当前能力、项目贡献与可核实成果。聊天是补充入口。

## Information architecture

单页 `/`：个人信息与联系方式 → 核心指标与个人总结 → 工作经历 → 项目经验 → 教育与个人作品。允许在不改变原文的前提下重排个人信息。简历内容不折叠或截断。

聊天默认收起为右下角入口；打开后保留当页消息，刷新即清空。

## Design principles

正文优先。布局应适应内容；不得为了打印两页而删改简历。浮窗移动与停靠是显式、可逆操作；输入、滚动、按钮点击不触发拖动。

## Visual language

- 页面底色 `#fafaf8`（用户指定）、暖白 `#faf9f5`、墨蓝 `#1B365D`、正文 `#141413`、次要文字 `#504e49`、边界 `#e8e6dc`。
- 全站优先 `PingFang SC`，缺失时回退到系统无衬线；不提供字体下载，不再维护 Noto Serif SC 子集。
- 正文行高 1.45；章节上间距 28px（手机 24px），标题分隔线下间距 10px，段落 / 列表项间距 6px、嵌套项 4px，项目上下内边距各 12px、项目标题下间距 6px。页首 40px（手机 28px）。间距借鉴 PDF，但保持网页字号及连续滚动。
- 模板姓名、联系方式、metrics、timeline、section-title、project 是结构和 CSS 的直接适配来源。网页使用可读字号及连续滚动，保留 400 / 500 权重。
- 不向前端引入整套 Tailwind / Motion；Beautiful UI 使用到的 token、结构和动画转换为局部 CSS。动效仅传达等待和位置变化。

## Components

`ResumePage` 负责模板与 Markdown 内容；小型解析器只支持当前 README 使用的 Markdown 子集，使用 React 节点输出，不注入 HTML。

`ChatWidget` 管理入口、历史、发送和取消。窗口三态：floating / left / right。`ThinkingState`、聊天气泡与 composer 从 Beautiful UI 官方源码适配，去除示例 timer、示例来源及虚构推理步骤。

`App` 通过 data 属性控制页面留位。停靠宽度 `clamp(320px, 32vw, 400px)`。正文以 container query 适应实际剩余宽度。

## Accessibility

语义化标题、main、跳转正文入口；按钮有中文可访问名称，图标 aria-hidden；焦点清晰，聊天打开聚焦输入，关闭回到入口。Escape 关闭，Enter 发送、Shift+Enter 换行，输入法组合输入不发送。停靠 / 恢复按钮作为键盘替代操作。

遵守 prefers-reduced-motion；聊天消息为可访问的增量日志，错误与等待有明确文字。

## Responsive behavior

>=768px：浮窗限定在视口内，可拖动，左 / 右停靠为全高侧栏并为正文留位。停靠后的狭窄正文由 container query 转为单列。

<768px：聊天覆盖为全屏交互面板，隐藏拖动和停靠操作，正文不预留侧栏空白。手机关闭聊天后回到原阅读位置。

## Interaction states

默认收起；空会话显示少量基于简历主题的建议问题。请求中显示真实的 Mock 等待状态、禁用重复发送并可取消；成功追加固定 Mock 回复；失败保留原问题并可重试，不能重复追加同一用户消息。

拖动使用 Pointer Events / capture，左右边缘出现吸附提示；窗口缩放时重新限定坐标，pointercancel 不停靠。

## Content voice

中文，简短直接；所有经历和指标以 README 原文为准。Mock 状态不宣称已连接模型，不展示虚构的搜索、资料读取或思维链。正文中不出现后端配置或部署信息。

## Implementation constraints

保持 React + TypeScript + Vite、现有 Mock API 和 CORS 配置。仅增加明确指定的 Heroicons 依赖；第三方模板与组件的 MIT 声明集中保留。不发送私有资料。

Kami 网页适配的明确偏离：字体按用户要求采用苹方；不套用打印模板的严格两页、固定四指标与重写项目字数要求，保留现有简历全文。以网页构建、内容覆盖测试、真实浏览器交互及响应式截图验证，不生成或宣称验证了 PDF。

验证：类型检查、Lint、API 与前端纯函数测试、生产构建；桌面基线 1280px、手机 375px / 320px、767px / 768px 断点两侧及平板宽度。检查左 / 右停靠占位、拖动、关闭恢复、Mock 发送、键盘与页面溢出。

2026-10-20 本地验收：Lint、类型检查、18 项前后端测试、生产构建通过。Chrome 实测 320 / 375 / 767 / 768 / 1024 / 1280px，验证浮窗拖动及左边缘吸附、左右全高停靠让位、恢复浮窗、Mock 收发、手机 Tab 循环 / Escape 关闭 / 焦点恢复。320px 纵向滚动条场景已按 `scrollWidth <= clientWidth` 检查无横向溢出；完整重载后控制台无 warning / error。截图存于忽略目录 `.artifacts/resume-desktop-chat.png` 与 `.artifacts/resume-mobile.png`。未验证真实手机软键盘、浏览器网络中断与 15 秒超时；未发布此版 UI。

## Open questions

无阻塞项。左右停靠已由用户确认；聊天继续 Mock。当前任务完成本地前端实现与验证，线上变更按当次任务授权处理。

2026-10-20 字体与间距调整验收：参考 PDF 两页均已查看；全站改为苹方优先，移除衬线字体文件、生成脚本及两项已不适用的字体子集测试，保留简历内容覆盖与聊天几何测试。Lint、类型检查、16 项测试及构建通过。Chrome 实测 320 / 375 / 768 / 1280px 均无横向溢出，正文计算行高为 23.2px（手机 21.75px），768px 右侧停靠后正文宽 433px、聊天栏宽 320px，互不覆盖。新截图为 `.artifacts/resume-pingfang-desktop.png`、`.artifacts/resume-pingfang-mobile.png`。未发布。
