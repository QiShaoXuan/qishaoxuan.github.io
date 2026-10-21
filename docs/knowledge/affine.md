# AFFiNE / BlockSuite 项目总结与问答素材

整理日期：2026-10-20。经历范围：简历记载的 2022-05 至 2023-09。

**状态：第 1–6 节已纳入聊天服务的构建输入，线上生效以实际发布版本为准。** 本文按当前 [简历](../../readme.md) 的职责口径、公开历史代码和本人确认的项目讲述整理。2026-10-20，本人已确认第 6 节的三组选型理由、方案比较和剪贴板重构案例，包括定位过程；相关问答同步采用这一口径。量化收益、其他协作与复盘案例可继续补充。

配套文件：[证据与核验边界](affine-evidence.md)、[533 条匹配作者提交索引](archive/affine-contributions.tsv)。

## 1. 经历与个人贡献

### 简短介绍

2022 年 5 月至 2023 年 9 月，我在 AFFiNE 担任前端核心开发，参与从早期 live demo 到 Web、Electron 产品的迭代。工作分为两部分：AFFiNE 应用层的工作区、页面组织、设置和交互能力，以及 BlockSuite 编辑器层的剪贴板、Bookmark Block 和部分底层接口开发。

### 展开介绍

在应用层，我参与 monorepo 调整和 Provider / AppState 重构，负责工作区管理、子页面、Pinboard、收藏、回收站、快捷搜索、主题、账号及成员邀请等功能，并重构设置中心。在编辑器层，我参与剪贴板重构，整理复制、粘贴与数据转换逻辑，实现 Bookmark Block，并处理白板交互、异步更新、撤销重做和测试相关问题。

上述“实现 Bookmark Block”沿用简历的职责描述；公开提交存在共同作者，不能据此扩写成“全部独立完成”。

### 个人贡献概览

| 方向 | 本人贡献 | 对应工作 |
| --- | --- | --- |
| 应用架构 | 参与工程组织调整，重构应用状态与跨模块事件处理。 | monorepo、Provider / AppState、工作区切换、主题事件、MessageCenterHandler。 |
| 工作区与页面组织 | 负责工作区、子页面、Pinboard、收藏、回收站和快捷搜索等功能。 | 页面树与引用关系、导航路径、页面删除与关系维护。 |
| 设置与交互 | 重构设置中心，参与共享组件维护和拖拽实现迁移。 | 设置弹窗、主题、Button / Menu / Tooltip / Modal、react-dnd 到 dnd-kit。 |
| 账号与成员流程 | 负责账号及成员邀请相关功能。 | 登录与用户信息操作、邀请页与邀请信息、请求中状态、成员列表分页。 |
| 编辑器与测试 | 参与剪贴板和底层接口开发，实现 Bookmark Block 并持续维护相关交互与测试。 | 内容转换与兼容处理、书签卡片、异步更新、undo/redo、页面接口、readonly、回归测试。 |

### 公开记录的统计口径

| 仓库 | 匹配作者提交 | 非合并提交 | 合并提交 | 含共同作者标记 |
| --- | ---: | ---: | ---: | ---: |
| AFFiNE | 443 | 336 | 107 | 28 |
| BlockSuite | 90 | 83 | 7 | 12 |

统计范围为指定历史快照内、指定作者邮箱与提交者时间范围的 Git 记录，包含合并提交和多人协作。数字不是 PR 数、独立交付功能数、全部个人贡献或工作量指标；共同作者列可能与其他列重叠。上述记录支持简历中的“440+ / 90”数量级，引用数字时需保留统计范围；GitHub star 数不能作为个人贡献的因果结果。统计来源与复现方式保存在[证据索引](affine-evidence.md#1-检索范围与统计口径)。

## 2. 主要工作时间线

日期按北京时间的作者日期展示，用于梳理个人工作阶段。

| 阶段 | 公开记录中可见的工作 | 阅读提示 |
| --- | --- | --- |
| 2022-07 至 09 | 早期 AFFiNE 编辑器的剪贴板、块与 HTML 转换、白板粘贴、输入组件、主题处理。 | AFFiNE 仓库早期编辑器代码，不能全部称为后来的 BlockSuite 实现。 |
| 2022-10 至 2023-01 | monorepo 合并协作、主题、应用状态与工作区初始化；BlockSuite 块样式、Todo 列表、Store / Space 边界、动态 ID、readonly。 | monorepo 关键原始提交作者为 alt0，Qi 有合并记录；不能写成本人独立完成。 |
| 2023-02 至 04 | MessageCenterHandler、工作区、子页面、Pinboard、回收站、快捷搜索、拖拽迁移；BlockSuite 剪贴板及子页接口和测试。 | 区分应用层页面组织与编辑器数据层接口。 |
| 2023-05 至 06 | 链接自动识别、跨仓库 Bookmark 集成、元数据获取调整、书签测试与撤销重做修复；设置弹窗重构。 | 书签块、宿主元数据服务、测试工具是三个不同问题。 |
| 2023-07 至 09 | 组件迁移、设置细节、登录与邀请交互、成员列表分页和持续问题修复。 | 围绕账号、成员管理和统一交互完善应用体验。 |

任职起点为 2022-05；上述时间线展示公开提交中的工作阶段，不代表入职日期或此前是否开展工作。

## 3. 项目实现与职责

项目材料覆盖应用层与编辑器层的个人行动、历史实现和结果边界。

### 3.1 应用工程结构与 monorepo

1. **背景与目标**：简历记录参与项目由早期演示向产品迭代及 monorepo 调整。某一次调整中，应用迁入 `packages/app`，通过 `pnpm-workspace.yaml` 管理 `packages/*`。
2. **个人职责**：参与 monorepo 调整。`0279dc44` 的原始代码作者是 alt0，Qi 的 `e26d10f4` 是合并该 PR 的记录；不能把原始重构全部归于本人。
3. **方案与难点**：可观察到应用文件迁移、根脚本和依赖调整。历史目录从 `packages/app` 演进到 `apps/web`、桌面应用及多个共享包，不能把某一时点目录说成整个任职期固定架构。
4. **结果与复盘**：可以说工程组织发生调整；没有可引用的构建提速、维护成本、复用率或个人主导程度指标。
5. **来源**：[原始变更](https://github.com/toeverything/AFFiNE/commit/0279dc44b742f5951182e4eff5cfe96a87cab993)、[合并记录](https://github.com/toeverything/AFFiNE/commit/e26d10f4d0d4f6005c76e188488acac6cb327f5f)。

### 3.2 Provider、AppState、工作区切换与错误处理

1. **背景与目标**：应用需要衔接数据中心、工作区、页面和编辑器状态。调整应用共享数据与页面编辑器实例的职责边界，将分散的创建、挂载和初始化流程集中起来。
2. **个人行动**：有 AppState / Provider 重构、工作区变更事件、用户与登录状态整理、主题事件处理及 `MessageCenterHandler` 的作者记录。
3. **技术观察**：Provider 初始化读取数据中心、工作区与页面元数据，订阅更新并同步应用状态；`MessageCenterHandler` 订阅统一消息，遇到无权限状态时提示、清除本地认证状态并刷新页面。该历史实现含 TODO，不能描述成完整、最终的权限体系。
4. **结果与边界**：有跨模块状态和错误处理代码落地证据；没有状态更新耗时、故障率等指标。`#770` 有 Peng Xiao 共同作者，属于协作实现。
5. **来源**：[AppState](https://github.com/toeverything/AFFiNE/commit/28b2943dc67c381e66ec1799a3c3c9754fb5b13d)、[工作区事件](https://github.com/toeverything/AFFiNE/commit/15f06fe85e515314f22296e73ce627079518a5bd)、[编辑器职责拆分](https://github.com/toeverything/AFFiNE/commit/a6f81e235907e261870433e826a358564e33a041)、[Provider 整理](https://github.com/toeverything/AFFiNE/commit/e8431122c9a289858cd57ddac432c046f426fb5f)、[MessageCenterHandler #770](https://github.com/toeverything/AFFiNE/pull/770)。

### 3.3 Workspace、子页面、Pinboard、回收站与快捷搜索

1. **背景与目标**：围绕工作区中的页面组织、查找与操作，连接树形页面关系、Pinboard、回收站和搜索路径。
2. **个人行动**：实现或迭代工作区切换与删除、子页面树、root pinboard、引用关系、回收站关系维护和快速搜索中的导航路径；责任级别仍以简历为准。
3. **技术观察**：`#1663` 接入子页面与树组件；`#1843` 增加 root pinboard 并迁移 pivots 命名；`#1871` 在页面移入回收站时同步移除父页面中的子页关系；`#1920` 增加搜索中的导航路径，并修改相关测试。
4. **结果与边界**：可以给出页面关系和具体交互的实现案例，不能补写用户规模、使用率或组织效率提升。收藏等功能属于简历记载的职责范围。
5. **来源**：[#1663](https://github.com/toeverything/AFFiNE/pull/1663)、[#1843](https://github.com/toeverything/AFFiNE/pull/1843)、[#1859](https://github.com/toeverything/AFFiNE/pull/1859)、[#1871](https://github.com/toeverything/AFFiNE/pull/1871)、[#1920](https://github.com/toeverything/AFFiNE/pull/1920)。

### 3.4 设置中心、共享组件、主题与拖拽

1. **背景与目标**：公开需求 `#2030` 提到统一当时并存的拖拽实现。统一交互基础、减少两套状态与事件逻辑的维护，是拖拽迁移的主要目标；设置与其他组件迁移属于对应模块的迭代。
2. **个人行动**：参与 `react-dnd` 到 `dnd-kit` 替换、新设置弹窗及工作区设置迁移、Button / IconButton、Menu、Tooltip、Modal 等组件更新，并处理主题和样式问题。
3. **技术观察**：`#2028` 替换拖拽实现并清理依赖；`#2900` 将工作区设置迁入新弹窗；`#3608` 改用共享组件导出的按钮；`#4324` 替换新设计 Modal。设置测试覆盖主题、布局宽度、快捷键和 About 等入口。
4. **结果与边界**：能说明组件与交互实际变更及有测试维护；不宣称本人独立设计整个组件库，也不推导包体积、性能或研发效率收益。
5. **来源**：[#2028](https://github.com/toeverything/AFFiNE/pull/2028)、[需求 #2030](https://github.com/toeverything/AFFiNE/issues/2030)、[#2900](https://github.com/toeverything/AFFiNE/pull/2900)、[#2925](https://github.com/toeverything/AFFiNE/pull/2925)、[#3608](https://github.com/toeverything/AFFiNE/pull/3608)、[#4324](https://github.com/toeverything/AFFiNE/pull/4324)。

### 3.5 登录、账号设置与成员邀请

1. **背景与目标**：负责账号及成员邀请相关功能，涉及密码登录、邀请页、邀请邮件和成员列表等迭代。
2. **个人行动**：用户与登录状态重构、邀请页和异常入口修复、成员列表分页，以及部分邀请 API / 页面协作。不能从这些记录扩大为整个账号后端负责人。
3. **技术观察**：`#3504` 涉及密码登录与用户信息操作；`#3897` 包含 `getInviteInfo`、请求中状态及邀请页调整；`#4231` 支持成员列表分页。
4. **结果与贡献**：完成账号与成员流程的多项功能迭代，包括登录与用户信息操作、邀请信息获取、邀请交互和成员列表分页。
5. **来源**：[#1097](https://github.com/toeverything/AFFiNE/pull/1097)、[#3504](https://github.com/toeverything/AFFiNE/pull/3504)、[#3897](https://github.com/toeverything/AFFiNE/pull/3897)、[#4231](https://github.com/toeverything/AFFiNE/pull/4231)。

### 3.6 早期 AFFiNE 编辑器的剪贴板

1. **背景与目标**：2022 年 AFFiNE 早期编辑器代码已存在文档与白板之间的复制粘贴、块与 HTML 转换等需求。
2. **个人行动**：历史作者记录包含 clipboard 重构、`block2html`、`html2block`、`ClipboardUtils` 整理，以及白板复制和粘贴问题修复。
3. **技术观察**：相关路径在当时的 `libs/components/editor-core/src/editor/clipboard/`；2022-08 的变更与后续独立 BlockSuite 仓库内的重构应分开描述。
4. **结果与边界**：可说明具体转换和兼容问题，不把后来的全部编辑器能力倒推到早期版本，也没有浏览器覆盖率、缺陷下降比例等结果指标。
5. **来源**：[block2html 重构](https://github.com/toeverything/AFFiNE/commit/4b904ef76204655e6253deabfab22d47d98feec4)、[html2block 重构](https://github.com/toeverything/AFFiNE/commit/012c0441d0e96a4b6f2dead990ab69a32d064ad8)、[白板粘贴入口](https://github.com/toeverything/AFFiNE/commit/c20288ce7638567f3efff80b7d5d24b38ae374bc)。

### 3.7 BlockSuite 剪贴板架构与兼容修复

1. **背景与目标**：块级编辑器需要在剪切、复制、粘贴时维护内容结构；历史变更可见入口、解析器与块 Service 之间的职责调整。
2. **个人行动**：参与剪贴板重构和兼容处理，修复多块复制的文本分隔、嵌套列表剪贴及粘贴多余内容等问题，并补测试。
3. **技术观察**：`#1687` 将 Page 剪贴板入口和 ContentParser 迁入 blocks 内部，通过块 Service 的序列化 / 反序列化处理内容；`#1936` 包含嵌套列表剪切粘贴后保留结构的测试。该次 `#1687` 中 EdgelessClipboard 仍有 TODO。
4. **结果与边界**：完成剪贴板结构调整和回归测试变更；单次重构的范围不等于全部白板剪贴板能力。`#1936` 包含 zqran 共同作者。
5. **来源**：[#1687](https://github.com/toeverything/blocksuite/pull/1687)、[#1936](https://github.com/toeverything/blocksuite/pull/1936)、[#2112](https://github.com/toeverything/blocksuite/pull/2112)、[#2276](https://github.com/toeverything/blocksuite/pull/2276)。

### 3.8 Bookmark Block、链接识别与宿主集成

1. **背景与目标**：将 URL 转成可展示标题、描述、图标和图片的书签卡片，涉及编辑器块与宿主元数据获取两部分。
2. **个人行动**：简历记录从零实现 Bookmark Block。公开证据覆盖块模型、UI、创建入口、宿主接口集成、URL 自动识别、测试及后续白板交互维护；关键 `#2693` 有 Yifeng Wang 共同作者。
3. **技术观察**：BlockSuite `#2693` 添加书签模型、块、Service、弹窗、工具栏及 BlockHub / SlashMenu 入口，通过宿主 `getBookmarkDataByLink` 获取元数据；AFFiNE `#2458` 做宿主集成，AFFiNE `#2700` 最终使用 `link-preview-js` 获取元数据，设置超时与失败回退。BlockSuite `#2912` 避免异步回填已删除块，BlockSuite `#2951` 处理元数据更新与 undo/redo 历史的边界。
4. **结果与边界**：有跨仓库实现、边界修复和测试证据。`#2980` 的测试覆盖 SlashMenu / BlockHub 创建及转普通链接，其中粘贴创建没有在该测试中覆盖。不能说本人独立实现全部抓取服务、支持所有网页、没有异步竞态或完整覆盖所有白板场景。
5. **来源**：[BlockSuite #2624](https://github.com/toeverything/blocksuite/pull/2624)、[#2693](https://github.com/toeverything/blocksuite/pull/2693)、[#2786](https://github.com/toeverything/blocksuite/pull/2786)、[#2912](https://github.com/toeverything/blocksuite/pull/2912)、[#2951](https://github.com/toeverything/blocksuite/pull/2951)、[#2980](https://github.com/toeverything/blocksuite/pull/2980)、[AFFiNE #2458](https://github.com/toeverything/AFFiNE/pull/2458)、[#2700](https://github.com/toeverything/AFFiNE/pull/2700)。

### 3.9 BlockSuite 数据边界、页面接口与只读状态

1. **背景与目标**：应用需要把编辑器接到指定的数据空间，并维护页面关系和可编辑状态。这里是历史代码中的能力，不是当前 BlockSuite 架构说明。
2. **个人行动**：参与 Block 与 Store 解耦、动态 ID、Space 接口、子页元信息和事件、`shiftPage` 以及 readonly 相关开发。
3. **技术观察**：`#191` 的入口改为接收 Space；`#219` 不再固定使用 `page0`；`#1716` 增加父子页元信息及事件；`#1828` 在事务中调整 PageMeta 列表顺序；`#311/#316` 将 readonly 传到编辑区域和标题输入。
4. **结果与边界**：`shiftPage` 是页面元信息列表排序，不是跨工作区搬迁；readonly 是编辑器 UI 的编辑限制，不是后端授权。`#1828/#1832` 有共同作者，不能描述成全部独立完成。
5. **来源**：[#191](https://github.com/toeverything/blocksuite/pull/191)、[#219](https://github.com/toeverything/blocksuite/pull/219)、[#311](https://github.com/toeverything/blocksuite/pull/311)、[#316](https://github.com/toeverything/blocksuite/pull/316)、[#1716](https://github.com/toeverything/blocksuite/pull/1716)、[#1828](https://github.com/toeverything/blocksuite/pull/1828)、[#1832](https://github.com/toeverything/blocksuite/pull/1832)。

### 3.10 编辑器交互、测试与开源协作

1. **背景与目标**：历史工作还覆盖块样式、Todo 列表、Page / Edgeless 的拖拽与光标问题，以及已实现功能的持续维护。
2. **个人行动**：有块样式迁移、Todo、白板拖出块后的原块拆分、缩放视口方向键光标、图标图片 fallback 等提交；应用层和编辑器层都有测试变更。
3. **技术观察**：可用的测试实例包括 Pinboard、快捷搜索、设置弹窗、剪贴板结构、子页排序和书签入口。AFFiNE 设置测试 `#2925` 明确使用 Playwright，能证明维护了相关测试。
4. **结果与协作边界**：参与公开 PR、代码修订和协作合并。共同作者记录体现协作，不能据此推断团队规模、管理职责或具体分歧处理过程。
5. **来源**：[BlockSuite #58](https://github.com/toeverything/blocksuite/pull/58)、[#2477](https://github.com/toeverything/blocksuite/pull/2477)、[#2532](https://github.com/toeverything/blocksuite/pull/2532)、[AFFiNE #2925](https://github.com/toeverything/AFFiNE/pull/2925)。

## 4. 常见问答

以下按工作内容、技术取舍和个人贡献介绍项目。

### Q1：你在 AFFiNE 主要做了什么？

齐少轩主要做 AFFiNE 的前端应用和部分 BlockSuite 编辑器开发。应用侧包括工作区、子页面、Pinboard、搜索、设置、主题、账号和成员邀请；编辑器侧重点是剪贴板、Bookmark Block，以及部分数据接口和交互维护。

### Q2：AFFiNE 和 BlockSuite 是什么关系？

在这段经历中，AFFiNE 是面向用户的产品应用，BlockSuite 是其底层块级编辑器。工作区、设置和账号等属于应用层；块模型、编辑交互和剪贴板等主要在编辑器层。两者通过接口配合，例如书签块需要调用 AFFiNE 宿主提供的元数据接口。

### Q3：能举一个比较完整的项目吗？

可以看 Bookmark Block。简历记录他从零实现了这个块，包括链接识别、卡片展示、白板插入与拖拽、undo/redo 和测试。公开提交还能看到编辑器模型、宿主集成、异步回填及测试的变更；部分关键提交由多人协作完成，不能说所有部分都由他独立实现。

### Q4：书签卡片的元数据怎么来，为什么调整方案？

BlockSuite 通过 AFFiNE 宿主接口获取标题、描述、图标和图片。原方案需要启动隐藏浏览器窗口读取 HTML，再维护提取规则；他在调整中尝试浏览器自动化方案，最终采用 `link-preview-js`，统一超时、重定向、失败回退和字段映射。选型重点是聚焦书签预览需要的数据、减少窗口和解析流程的维护；复杂动态页面的覆盖能力属于需要考虑的取舍。

### Q5：书签功能涉及哪些复杂问题？

复杂问题包括元数据异步返回时块已被删除、元数据更新与 undo/redo 的历史边界，以及白板插入和拖拽交互。相关工作包括避免更新已删除块、区分元数据内部更新与用户操作，并维护书签卡片的白板交互。

### Q6：剪贴板具体做了什么？

他参与重构复制粘贴流程，整理块与 HTML 的转换，并处理多块复制、嵌套结构和粘贴多余内容等兼容问题。一项代表工作是 BlockSuite `#1687`：沿输入、解析、模型插入和选区恢复梳理流程，将通用 PasteManager 中的职责拆到事件入口、ContentParser 与块 Service。早期 AFFiNE 与后续 BlockSuite 的工作按具体版本区分。

### Q7：为什么把 react-dnd 换成 dnd-kit？

当时项目里两套实现并存，他优先考虑统一拖拽基础，减少不同组件分别维护事件、状态和交互规则的成本。可以继续保留 react-dnd 做局部调整，也可以统一到项目已经使用的 dnd-kit；他选择后者，并处理点击与拖动区分、预览、落点和统一回调。例如设置 8px 激活距离，避免点选节点时误触发拖拽。这里的比较集中在现有两条路线，不扩写成广泛框架评测或量化性能收益。

### Q8：在架构方面有什么贡献？

他参与 monorepo 调整、Provider / AppState 重构，以及工作区和主题等跨模块事件处理。在 BlockSuite 中还参与编辑器与数据层边界、动态 ID、页面接口和只读状态的开发。这些是具体模块贡献，不代表独立设计整个应用或编辑器架构。

### Q9：他是前端还是全栈？

这段经历的主要角色是前端核心开发，工作延伸到编辑器底层和宿主接口集成。公开 PR 有账号、邀请和书签元数据相关变更，但不能据此说他独立负责全部后端、登录系统或服务架构。

### Q10：做过哪些测试？

历史记录中有设置弹窗、Pinboard、快捷搜索、剪贴板、子页面和书签功能的测试变更。例如设置测试检查弹窗打开、主题、布局宽度等行为。

### Q11：工作取得了什么效果？

成果体现在功能交付、职责拆分、兼容修复和测试维护，以及持续的公开贡献。资料没有提供 AFFiNE 这段经历的量化业务或性能指标，不能编造用户增长、加载提速、效率提升等数字，也不能把项目 star 增长归因为个人贡献。

### Q12：443 和 90 次提交代表什么？

这是指定历史快照、作者邮箱和提交者时间范围内的 Git 记录，包含合并提交，也包含多人协作的变更。它能作为贡献记录的索引，不能等同独立完成的功能数、PR 数或工作量；也没有覆盖所有 review、issue 和其他协作。

### Q13：你如何跟团队协作、处理分歧？

他参与 PR、共同修订和合并协作。仅凭这些记录不能还原某次具体分歧、决策过程或沟通方式，也不能编造团队沟通故事。

### Q14：哪些工作最能体现他的贡献？

可以从应用和编辑器两层看：应用层负责工作区、页面组织、设置及账号成员交互，并参与应用状态与工程结构调整；编辑器层参与剪贴板重构、数据接口开发和 Bookmark Block 实现。书签功能还串联了块模型、卡片 UI、宿主元数据接口、异步更新和 undo/redo，能作为深入介绍跨模块开发经历的例子。

### Q15：为什么拆分 Provider 和编辑器相关逻辑？

应用共享数据与编辑器实例的生命周期不同。他保留 Context 管理用户、工作区和页面等共享数据，把浏览器端编辑器的创建、挂载和空白页初始化集中到编辑器组件，再提供实例引用给外部组件使用；具体加载哪个工作区交给路由处理。这次优先调整现有体系的职责与调用关系，没有把更换状态库当作解决边界问题的前提。

### Q16：能讲一次比较棘手的问题定位和解决过程吗？

可以讲 BlockSuite `#1687` 的剪贴板重构。他沿“剪贴板输入、内容解析、模型插入、选区恢复”梳理调用链，定位到通用 PasteManager 中混合了不同块类型和选区状态的处理。随后将事件接入、格式解析和具体块的插入规则拆开，并调整事件绑定、清理及测试入口。代表场景是在 `abc` 中选中 `b`，粘贴两个块后保留首尾内容，得到 `atext` 和 `h1c`，光标位于第二个块的 `h1` 之后、`c` 之前。

## 5. 贡献描述与技术要点

| 方向 | 当前贡献口径 | 实现要点 |
| --- | --- | --- |
| 工程结构 | 参与 monorepo 调整与协作。 | 结合应用与公共包的组织方式介绍具体参与内容。 |
| Bookmark Block | 实现书签块，并与共同贡献者协作完善相关能力。 | 分为模型、UI、创建入口、宿主元数据获取、异步更新、undo/redo 和测试。 |
| 页面接口 | 参与子页关系、事件与页面元信息排序接口开发。 | `shiftPage` 调整 PageMeta 列表顺序。 |
| readonly | 参与编辑器只读状态开发及一致性修复。 | 控制内容、标题输入及相关编辑交互。 |
| 剪贴板 | 参与重构、兼容处理和回归测试。 | 按内容转换、结构保留及文档 / 白板具体场景展开。 |
| 贡献记录 | 在指定历史口径下，AFFiNE 匹配 443 个提交，BlockSuite 匹配 90 个提交。 | 数字包含合并和协作记录，具体工作由对应模块与实现说明。 |

## 6. 选型理由与复杂案例

以下介绍拖拽库迁移、应用状态职责拆分、书签元数据方案和剪贴板重构的背景、取舍与个人过程。

### 6.1 为什么选择 dnd-kit，比较了什么

当时项目里同时使用 react-dnd 和 dnd-kit。我推进这次调整，首先是统一拖拽实现，减少不同组件分别维护拖拽状态、事件和交互规则的成本。这个背景在当时的需求里有明确记录。

从方案上看，可以继续保留 react-dnd，逐步修补现有实现；也可以统一到项目已经使用的 dnd-kit。我更倾向后者，让树形目录、Pinboard 等场景使用一致的交互基础。

迁移时也需要处理具体行为：区分点击和拖动、展示拖拽预览、计算落点，再把移动结果交给业务层。例如设置 8px 的拖动激活距离，避免点选节点时误触发拖拽，并通过统一的 `onDrop` 回调处理节点移动。

这里的比较重点是统一现有实现、控制交互和降低维护成本，不扩写成一次覆盖很多拖拽库的选型评测。

来源：[需求 #2030](https://github.com/toeverything/AFFiNE/issues/2030)、[迁移 #2028](https://github.com/toeverything/AFFiNE/pull/2028)、[固定版本 TreeView 实现](https://github.com/toeverything/AFFiNE/blob/a5a6203a955680f32310b03c7ac427b37bc91fc4/packages/component/src/ui/tree-view/TreeView.tsx)。

### 6.2 为什么这样拆分状态

这次主要调整的是应用共享状态和编辑器实例的职责边界。

用户、工作区列表、当前工作区和页面属于应用级数据；编辑器则需要跟随当前页面，在浏览器里创建、挂载和清理。原先 Provider 注册编辑器创建方法，页面再调用它，初始化流程分散在几个位置。

我保留 Context 管理共享数据，把编辑器创建、DOM 挂载和空白页初始化集中到编辑器组件，再把实例引用提供给工具栏等外部组件使用。同时，应用启动负责准备基础数据，具体加载哪个工作区交给路由处理。

继续把逻辑放在全局 Provider，会混合全局数据和页面实例的生命周期；全部放到页面，又不方便其他组件共享编辑器。引入新的状态库也不会自动解决这个问题，所以这里优先在现有体系上调整职责和调用关系。

来源：[编辑器职责拆分](https://github.com/toeverything/AFFiNE/commit/a6f81e235907e261870433e826a358564e33a041)、[工作区初始化调整](https://github.com/toeverything/AFFiNE/commit/e8431122c9a289858cd57ddac432c046f426fb5f)。

### 6.3 为什么调整书签元数据方案

书签卡片需要的是标题、摘要、图标和封面。原实现为了获取这些字段，需要启动隐藏浏览器窗口读取页面 HTML，再维护一套提取规则。

调整过程中尝试过浏览器自动化方案，最终将运行时实现收敛到 `link-preview-js`，外层统一处理超时、重定向、失败回退和返回字段，让编辑器拿到稳定的元数据结构。

两类方案的取舍是：完整浏览器可以执行页面脚本，但需要管理窗口和加载过程；链接预览库更聚焦元数据提取，业务侧需要维护的流程更少。对于书签卡片，我更关注拿到必要信息、控制等待时间，以及获取失败后仍能正常展示链接。复杂动态页面的覆盖能力，则需要作为这条路线的限制来考虑。

来源：[调整 #2700](https://github.com/toeverything/AFFiNE/pull/2700)、[最终元数据实现](https://github.com/toeverything/AFFiNE/blob/fda89b05e7b48b476d53dbcaea95f1868658e82a/plugins/bookmark-block/src/server.ts)。

### 6.4 复杂问题案例：BlockSuite #1687 剪贴板重构

比较棘手的一次是块级编辑器的剪贴板重构。

块级编辑器的粘贴涉及内容格式、块结构和光标位置。同一份内容，粘贴到段落、列表、代码块时，处理方式可能不同；如果用户先选中了一部分文字，还需要处理选区删除、块拆分、前后内容合并和光标恢复。

定位时，我先沿着“剪贴板输入 → 内容解析 → 模型插入 → 选区恢复”梳理调用链。旧实现把很多逻辑集中在通用 PasteManager 中，里面包含不同块类型和选区状态的特殊分支。一个边界调整，很容易影响其他粘贴场景。

例如，测试里有这样一个情况：

```text
原内容：a[b]c，选中 b
粘贴内容：text 和 h1 两个块

预期结果：
atext
h1c
```

这里要保留前面的 `a`，把后面的 `c` 接到最后一个块。光标应位于第二个块的 `h1` 之后、`c` 之前（块内偏移 2，选区长度 0），历史测试对应 `assertSelection(page, 1, 2, 0)`；不是落在 `c` 之后。

我把处理职责重新分开：剪贴板入口负责接收事件和读取格式；ContentParser 负责转换为块数据；具体块的 Service 负责插入规则。段落可以处理拆分、合并和子块插入，代码块则覆盖自己的粘贴行为，避免通用入口继续堆积块类型判断。

同时调整事件绑定与清理，并将部分测试从直接调用私有方法改为构造 ClipboardEvent、通过事件分发进入处理流程，检查文本、块结构和选区结果。

这次工作的主要结果是把格式转换、块行为和编辑器接入的职责理清，为后续兼容修复和新增块类型留下更明确的扩展位置。

来源：[提交 ed7a9fd / #1687](https://github.com/toeverything/blocksuite/commit/ed7a9fd3910bfc88d7cff021007deb89da56ee33)、[事件与插入流程](https://github.com/toeverything/blocksuite/blob/ed7a9fd3910bfc88d7cff021007deb89da56ee33/packages/blocks/src/__internal__/clipboard/page-clipboard.ts)、[测试变更](https://github.com/toeverything/blocksuite/blob/ed7a9fd3910bfc88d7cff021007deb89da56ee33/tests/clipboard.spec.ts)。

## 7. 后续可补充的素材

1. **更多个人行动**：在已确认的选型与剪贴板案例之外，补充 monorepo、Bookmark 或账号流程中的其他个人决策。
2. **其他技术取舍**：页面关系、数据兼容、只读交互等尚未展开的方案选择。
3. **协作与复盘**：一次设计或 code review 分歧、跨模块协作，或失败后调整方案的真实经历。
4. **结果与口径**：是否有可公开的用户反馈、性能或质量结果？提供基线、时间窗口、采样范围和个人与团队成果边界。
5. **证据与公开范围**：可以公开的文章、PR 和脱敏材料；哪些内部背景不能用于访客问答。

## 8. 知识库接入规则

`scripts/generate-chat-knowledge.mjs` 显式读取根 `readme.md` 与本文第 1–6 节，生成服务端知识模块。本文头部、第 7–8 节、证据索引和提交 TSV 不进入模型，也不扫描其他文件。每个输入不得超过 64 KiB，缺失或章节边界异常时构建失败。

简历保留任职时间与职责口径，本文补充已批准的实现细节和个人讲述；GitHub README 仅补充项目背景。两份正文分别计算内容版本，再计算聚合知识版本。聊天返回资料标识，部署后来源链接绑定发布提交；日志只记录版本、标识和运行状态。未发布的本地修改不代表线上已生效。

本文不包含原始私人聊天、内部设计链接、密钥或未经提供的内部资料。公开技术实现可以引用，但历史代码不能替本人承诺岗位、合作、薪酬或排期。
