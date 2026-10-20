# AFFiNE / BlockSuite 证据索引与核验记录

整理日期：2026-10-20。配套阅读：[项目总结与问答素材](affine.md)、[逐提交索引](affine-contributions.tsv)。

本文结合公开历史证据与本人确认的项目讲述整理，不是历史软件运行或质量评估。2026-10-20，本人已确认 dnd-kit、状态职责拆分、书签元数据方案的理由与比较，以及剪贴板重构的复杂案例和定位过程；完整内容见配套总结第 6 节。配套总结第 1–6 节已纳入聊天构建输入；本证据索引和原始提交 TSV 仅供人工追溯，不进入模型，线上状态以发布版本为准。

## 1. 检索范围与统计口径

| 项目 | AFFiNE | BlockSuite |
| --- | --- | --- |
| 来源 | 本次从官方 `toeverything/AFFiNE` 拉取的只读 bare 历史 | 本机已有官方 remote 对应的历史 Git 对象；未 fetch，不使用有修改的工作树内容 |
| 统计起点 | `v0.10.0`，`075439c74f004495277c76bf2478fc1d4f5b893e`，2023-11-10 | `master`，`0a1212f000a04baf7a1e0cd550cb0ce1f652fa7d`，2023-11-28 |
| 时间筛选 | 提交者时间在北京时间 2022-05-01 00:00:00（含）至 2023-10-01 00:00:00（不含） | 同左；实际查询采用等价的 `--until=2023-09-30T23:59:59+08:00` |
| 作者匹配 | `qishaoxuan777@gmail.com` 或 `474021214@qq.com`；可见名称 Qi / QiShaoXuan / qishaoxuan | `qishaoxuan777@gmail.com`；可见名称 Qi / QiShaoXuan |
| 总数 / 非 merge / merge | 443 / 336 / 107 | 90 / 83 / 7 |
| 含 `Co-authored-by` 的提交 | 28 | 12 |
| 匹配记录的作者日期范围 | 2022-07-25 至 2023-09-16 | 2022-09-29 至 2023-08-16 |

统计用提交者时间筛选，索引保留原始 ISO 作者时间及其时区；两者可能不同。正文中的具体日期按北京时间解释。merge 通过父提交数量判断，不能只根据提交标题是否以 `Merge` 开头判断。共同作者是布尔标记，不表示共同作者人数；缺少标记也不能证明独立完成。

本次检索了全部匹配提交的元数据和标题，深入读取了关键模块的历史差异；没有逐行审计 533 个提交的全部代码。TSV 的存在不代表所有变更已得到相同深度的核验。

AFFiNE 本地研究缓存使用部分克隆。443 个匹配的原始 commit 对象已批量读取，作者日期、父提交、共同作者标记和标题与 TSV 一致；扩展 `git show` 时，部分关联历史树或其他对象按需取回失败，例如展开 `0219ca83112d232ea0dfcbff3e014e28bdaca023` 时遇到缺失对象错误。不能将关联对象取回失败误写成这 443 个 commit 本身缺失。本次还核验了正文中 37 个固定提交引用，并直接读取关键实现；不宣称已完整展开 533 个提交关联的全部文件与差异。该缓存缺口不补写成代码或个人经历结论。

复现统计的查询形式如下；应在对应仓库执行。AFFiNE 的 author 正则为上表两个邮箱，BlockSuite 为一个邮箱：

```bash
git log <固定快照SHA> \
  --author='<邮箱正则>' \
  --since='2022-05-01T00:00:00+08:00' \
  --before='2023-10-01T00:00:00+08:00' \
  --format='%H %aI %cI %P %s'
```

### 口径的限制

1. 统计的是指定快照可达的 Git author 记录，不是当前 GitHub main/master 全量实时统计，也不等于 PR 数、独立交付数、工作量或绩效。
2. 未覆盖其他邮箱、仅作为共同作者的提交、review、issue、未合并分支、内部讨论或仓库迁移中未保留的工作；不能声称穷尽全部个人贡献。
3. 合并提交可能包含他人代码；cherry-pick 可能产生同一 PR 对应的不同 SHA；本索引不按补丁或 PR 去重。检索中 `#4072` 等在不同发布历史出现不同 SHA，不能混用。
4. PR 作者、commit author、committer、合并者和功能负责人属于不同记录；个人职责按当前简历口径整理，历史记录补充对应实现。
5. 作者日期跨度不是任职时间；项目 star、功能增长和当前 README 不能用于推断个人因果贡献。历史测试有改动不等于本次已运行、全部通过或线上无缺陷。

## 2. 来源分级与使用方式

| 等级 | 内容 | 如何用于问答 |
| --- | --- | --- |
| F：已确认简历事实 | 根 `readme.md` 的经历时间、角色、模块及职责描述 | 当前模型已有的个人事实来源；有冲突的句子先标记，不在本文扩写。 |
| C：已读历史代码差异 | 固定 commit 的接口、行为、测试和作者 / 共同作者记录 | 可描述“该历史版本实现了什么”；新增到个人知识前核对职责边界。 |
| P：公开 PR 记录 | 作者、变更内容、讨论和最终差异 | 关联具体贡献与实现来源，支撑对应模块的总结。 |
| U：本人已确认的项目讲述 | 2026-10-20 对话中确认的三组选型与剪贴板复杂案例 | 记录本人确认的理由、取舍、定位与处理过程；与公开实现证据一同引用。 |
| I：工程解释或待补充 | 一般技术解释、动机、选型比较、业务结果、个人复盘 | 一般解释必须与亲历分开；缺少事实的字段留空，不能变成个人经历。 |

## 3. AFFiNE 应用层关键证据

下面的固定 SHA 来自历史 Git 对象；PR 链接用于查看协作与合并状态。标记“元数据”表示该条在本次只检索了标题 / 路径，不应把它当作完整实现审查。

| 主题 | 日期（北京） | 来源 | 本次可支持的结论与限制 |
| --- | --- | --- | --- |
| monorepo 原始调整 | 2022-10-14 | [`0279dc44`](https://github.com/toeverything/AFFiNE/commit/0279dc44b742f5951182e4eff5cfe96a87cab993) / [#16](https://github.com/toeverything/AFFiNE/pull/16) | 原始作者 alt0；应用迁入 `packages/app`，增加 `pnpm-workspace.yaml`。不是 Qi 独立编写的证据。 |
| monorepo 合并协作 | 2022-10-14 | [`e26d10f4`](https://github.com/toeverything/AFFiNE/commit/e26d10f4d0d4f6005c76e188488acac6cb327f5f) | Qi 的合并记录。只能与简历“参与”对齐，不能等同代码独立实现。 |
| 主题事件 | 2022-09-26 | [`163f6cea`](https://github.com/toeverything/AFFiNE/commit/163f6cea08e83a5fd3bc4556682c862979d06523) | 元数据：增加 theme change handler；不推导具体收益或完整架构。 |
| AppState 重构 | 2023-01-09 | [`28b2943d`](https://github.com/toeverything/AFFiNE/commit/28b2943dc67c381e66ec1799a3c3c9754fb5b13d) | Provider 与数据中心、当前工作区、页面和编辑器的初始化 / 订阅关系有直接代码证据。 |
| 工作区变更事件 | 2023-01-09 | [`15f06fe8`](https://github.com/toeverything/AFFiNE/commit/15f06fe85e515314f22296e73ce627079518a5bd) | 订阅 `onWorkspacesChange`，更新 workspaceList；历史代码带 dispose 待完善注释。 |
| Provider 逻辑整理 | 2023-01-10 | [`e8431122`](https://github.com/toeverything/AFFiNE/commit/e8431122c9a289858cd57ddac432c046f426fb5f) | 工作区状态与初始化相关调整；不能由重构标题推出性能提升。 |
| 统一消息处理 | 2023-02-17 | [`cc1323f5`](https://github.com/toeverything/AFFiNE/commit/cc1323f5ccb8ea066dd38d47fb56f3b15808d871) / [#770](https://github.com/toeverything/AFFiNE/pull/770) | PR 作者 QiShaoXuan；含 Peng Xiao 共同作者，讨论有共同修订；无权限消息触发提示、清除认证状态和刷新。 |
| 子页面 | 2023-03-23 | [`6a7b5601`](https://github.com/toeverything/AFFiNE/commit/6a7b5601aa67e08651bd7c2d5a119138ef1d47b8) / [#1663](https://github.com/toeverything/AFFiNE/pull/1663) | 子页和树组件、页面元数据及应用接入有变更；与 BlockSuite 数据层接口区分。 |
| root Pinboard | 2023-04-08 | [`e50bf9fb`](https://github.com/toeverything/AFFiNE/commit/e50bf9fbfe700394dad16e033ba9395885178061) / [#1843](https://github.com/toeverything/AFFiNE/pull/1843) | 新增 root pinboard、pivots 命名迁移、数据及测试调整；PR 于 UTC 4 月 7 日合并，北京已为次日。 |
| 回收站页面关系 | 2023-04-12 | [`af04c1b8`](https://github.com/toeverything/AFFiNE/commit/af04c1b889a4b5faabaf6dd008235c968340e4a0) / [#1871](https://github.com/toeverything/AFFiNE/pull/1871) | 页面移入回收站时移除父页的子页关联，并调整相关调用与测试。 |
| 快捷搜索路径 | 2023-04-13 | [`7d64815a`](https://github.com/toeverything/AFFiNE/commit/7d64815aca5d6734ce129fbd88c4f41e1779ae09) / [#1920](https://github.com/toeverything/AFFiNE/pull/1920) | 加入导航路径及对应 quick-search 测试。 |
| 拖拽库迁移 | 2023-04-21 | [`a5a6203a`](https://github.com/toeverything/AFFiNE/commit/a5a6203a955680f32310b03c7ac427b37bc91fc4) / [#2028](https://github.com/toeverything/AFFiNE/pull/2028)、[需求 #2030](https://github.com/toeverything/AFFiNE/issues/2030) | PR 作者 QiShaoXuan，合入 master；公开需求支持统一实现，具体取舍另由本人确认的项目讲述补充。 |
| Bookmark 宿主集成 | 2023-05-26 | [`6d3c273f`](https://github.com/toeverything/AFFiNE/commit/6d3c273ffd1fccab9beacc3f5dfac1ed356c8882) / [#2458](https://github.com/toeverything/AFFiNE/pull/2458) | 元数据 / 模块路径：AFFiNE 接入书签功能；不能单凭标题推出全部实现细节。 |
| Bookmark 元数据获取 | 2023-06-08 | [`fda89b05`](https://github.com/toeverything/AFFiNE/commit/fda89b05e7b48b476d53dbcaea95f1868658e82a) / [#2700](https://github.com/toeverything/AFFiNE/pull/2700) | 含 himself65 共同作者；最终 `server.ts` 用 `link-preview-js` 获取书签元数据。详见第 5.1 节。 |
| Workspace 设置迁移 | 2023-06-28 | [`db40cd35`](https://github.com/toeverything/AFFiNE/commit/db40cd35c60f75a8485906dab873ac9fe2f197e2) / [#2900](https://github.com/toeverything/AFFiNE/pull/2900) | PR 作者 QiShaoXuan，合入 master；工作区设置迁入新设置弹窗。 |
| 设置测试 | 2023-06-29 | [`d7fcad2d`](https://github.com/toeverything/AFFiNE/commit/d7fcad2d0dc7b6a94b7586378f3edb8b8f53bf95) / [#2925](https://github.com/toeverything/AFFiNE/pull/2925) | 明确使用 Playwright，覆盖设置弹窗、主题、布局宽度、快捷键和 About。未运行历史测试。 |
| 密码登录 / 用户操作 | 2023-08-07 | [#3504](https://github.com/toeverything/AFFiNE/pull/3504) | PR 作者 QiShaoXuan；实现密码登录与用户信息操作。 |
| Button / IconButton | 2023-08-08 | [`6efe29f7`](https://github.com/toeverything/AFFiNE/commit/6efe29f7efa96b79a1d46cc23d560ed5133ee4c5) / [#3608](https://github.com/toeverything/AFFiNE/pull/3608) | PR 作者 QiShaoXuan，合入 master；替换为共享按钮并修正插件导入。 |
| 邀请流程 | 2023-08-25 | [#3897](https://github.com/toeverything/AFFiNE/pull/3897) | PR 作者 QiShaoXuan；包含 getInviteInfo、邀请页和请求中状态等实现。 |
| 成员列表分页 | 2023-09-12 | [`98429bf8`](https://github.com/toeverything/AFFiNE/commit/98429bf89e5341a51f5565e8393b468c072948de) / [#4231](https://github.com/toeverything/AFFiNE/pull/4231) | PR 作者 QiShaoXuan，合入 master；成员列表分页及相关测试变更。 |
| Modal 迁移 | 2023-09-13 | [`0b1ba6bf`](https://github.com/toeverything/AFFiNE/commit/0b1ba6bf43438f3d5b990e662ed06851ee91d215) / [#4324](https://github.com/toeverything/AFFiNE/pull/4324) | PR 作者 QiShaoXuan，合入 master；新设计 Modal 替换。 |

## 4. BlockSuite 编辑器层关键证据

本节来自本机固定历史 Git 对象和已读取的差异；PR URL 依据 squash 标题生成，未逐个在线重新打开。没有运行旧版本，也没有用本机现有工作树内容代替历史。

| 主题 | 日期（北京） | 固定来源 / PR | 直接观察与限制 |
| --- | --- | --- | --- |
| 块样式 | 2022-09-29 | [`39cad281`](https://github.com/toeverything/blocksuite/commit/39cad2813d11428918dfc624e9694cf6ea5c49cd) | 样式迁入块相关实现；不代表独立设计编辑器。 |
| Todo 列表 | 2022-10-13 | [`25e01b24`](https://github.com/toeverything/blocksuite/commit/25e01b241297f86bd2409ea8938d259268693d96) / [#58](https://github.com/toeverything/blocksuite/pull/58) | 列表 Todo 呈现与图标；有 Yifeng Wang 共同作者。 |
| Block / Store 解耦 | 2022-11-10 | [`30e4898e`](https://github.com/toeverything/blocksuite/commit/30e4898e2c5840d2fc8704294aa0a9eaddb58132) / [#191](https://github.com/toeverything/blocksuite/pull/191) | `getSpace/createSpace`、编辑器接收 Space；接口和依赖边界调整，不证明个人动机或性能收益。 |
| 动态 ID | 2022-11-25 | [`7777b8bc`](https://github.com/toeverything/blocksuite/commit/7777b8bc6875cf918dd496712517fd5acfa24f2a) / [#219](https://github.com/toeverything/blocksuite/pull/219) | `doc.getMap(this.id)` 与动态 spaceId，去除固定 `page0` 假设；历史实体名需保留版本语境。 |
| readonly | 2022-12-15 / 16 | [`2d7295ff`](https://github.com/toeverything/blocksuite/commit/2d7295ffb6f9746c4acf0a3b637edf2cb014dcaf) / [#311](https://github.com/toeverything/blocksuite/pull/311)、[#316](https://github.com/toeverything/blocksuite/pull/316) | 编辑区域、部分拖动 / 工具条与标题输入限制，不是后端权限系统。 |
| 剪贴板重构 | 2023-03-14 | [`ed7a9fd3`](https://github.com/toeverything/blocksuite/commit/ed7a9fd3910bfc88d7cff021007deb89da56ee33) / [#1687](https://github.com/toeverything/blocksuite/pull/1687) | Page 入口与 ContentParser 迁入 blocks，块 Service 负责转换；EdgelessClipboard 当时仍有 TODO。 |
| 子页关系 / 事件 | 2023-03-20 | [`12ae36d4`](https://github.com/toeverything/blocksuite/commit/12ae36d4ad108797aaf960e45441e0c4b7f5c966) / [#1716](https://github.com/toeverything/blocksuite/pull/1716) | 子页 ID 列表、父页存在校验、增删关系和事件。 |
| 页面排序及测试 | 2023-03-23 | [`e75ed32f`](https://github.com/toeverything/blocksuite/commit/e75ed32f0909bf2f044e5ec81ec62381a047f76f) / [#1828](https://github.com/toeverything/blocksuite/pull/1828)、[#1832](https://github.com/toeverything/blocksuite/pull/1832) | PageMeta 顺序调整和父子关系测试；不是跨 workspace 移动；有共同作者。 |
| 兼容与剪贴板测试 | 2023-04-04 | [`ed8e012f`](https://github.com/toeverything/blocksuite/commit/ed8e012fac95f72fce5247131f9f16bab25b177b) / [#1936](https://github.com/toeverything/blocksuite/pull/1936) | 嵌套列表剪切粘贴结构断言；有 zqran 共同作者；后续 [#2112](https://github.com/toeverything/blocksuite/pull/2112)、[#2276](https://github.com/toeverything/blocksuite/pull/2276) 修文本分隔及多余内容。 |
| 白板块拆分 / 光标 | 2023-05-10 / 11 | [`630a41f5`](https://github.com/toeverything/blocksuite/commit/630a41f53969bff5a46cf857c47bf83afd130aab) / [#2477](https://github.com/toeverything/blocksuite/pull/2477)、[#2532](https://github.com/toeverything/blocksuite/pull/2532) | 拖出块后拆分原块、缩放视口方向键光标修复；不等于主导整个白板。 |
| URL 自动识别 | 2023-05-18 / 29 | [`9cc8cae9`](https://github.com/toeverything/blocksuite/commit/9cc8cae9195f10e71364c3abb5fce7c819af027e) / [#2624](https://github.com/toeverything/blocksuite/pull/2624)、[#2786](https://github.com/toeverything/blocksuite/pull/2786) | 输入 / 合成和粘贴时匹配链接；后续仍有边界修复，不表示支持所有 URL。 |
| Bookmark 首次加入 | 2023-05-25 | [`97f30328`](https://github.com/toeverything/blocksuite/commit/97f30328eb493f148905403f0329319b118f0135) / [#2693](https://github.com/toeverything/blocksuite/pull/2693) | 块模型、UI、Service、创建入口、宿主调用；有 Yifeng Wang 共同作者。元数据抓取不在这一 diff 内。 |
| 异步删除保护 | 2023-05-31 | [`5c9b7d96`](https://github.com/toeverything/blocksuite/commit/5c9b7d96933865c5d2d2389514c7227789f7c200) / [#2912](https://github.com/toeverything/blocksuite/pull/2912) | 避免元数据异步返回后更新已删除块。 |
| Bookmark 测试 | 2023-06-05 | [`f2225fc5`](https://github.com/toeverything/blocksuite/commit/f2225fc5db0562d7f91921ae4f6b9b355620dd17) / [#2980](https://github.com/toeverything/blocksuite/pull/2980) | SlashMenu / BlockHub 创建、转普通链接；注释说明粘贴创建属于 AFFiNE 未在本测试覆盖。 |
| undo/redo 边界 | 2023-06-06 | [`895ea0bb`](https://github.com/toeverything/blocksuite/commit/895ea0bb3b27e761cbcf5b3219d248891977aec8) / [#2951](https://github.com/toeverything/blocksuite/pull/2951) | 元数据内部更新使用 `page.withoutTransact`，处理历史事务边界；不能泛化为全部协同事务设计。 |

## 5. 重点实现与个人贡献总结

### 5.1 #2700 的书签元数据实现

公开 [#2700](https://github.com/toeverything/AFFiNE/pull/2700) 的最终变更涉及书签链接预览：

1. 变更主要位于 `plugins/bookmark-block/`，删除原来基于 Electron BrowserWindow / Cheerio 的元数据处理。
2. 插件依赖去掉 `electron` / `cheerio`，增加 `link-preview-js`；最终 `server.ts` 调用 `getLinkPreview`。
3. 参数含 6000ms 超时、`googlebot` User-Agent、跟随重定向；失败回退为空元数据，返回标题、描述、首个 favicon 和图片。

可复查的固定文件：[合并提交中的 server.ts](https://github.com/toeverything/AFFiNE/blob/fda89b05e7b48b476d53dbcaea95f1868658e82a/plugins/bookmark-block/src/server.ts)、[PR head 同文件](https://github.com/toeverything/AFFiNE/blob/4a50a95504a2336058e4601dbc9acdc6d348aab8/plugins/bookmark-block/src/server.ts#L29-L54)。

### 5.2 登录、账号与成员邀请贡献

按当前简历口径，总结为：负责账号及成员邀请相关功能，参与用户与登录状态整理，完善密码登录、用户信息操作、邀请信息获取、邀请页和请求中状态，并支持成员列表分页。

对应来源：[#1097](https://github.com/toeverything/AFFiNE/pull/1097)、[#3504](https://github.com/toeverything/AFFiNE/pull/3504)、[#3897](https://github.com/toeverything/AFFiNE/pull/3897)、[#4231](https://github.com/toeverything/AFFiNE/pull/4231)。

### 5.3 本人贡献总结

1. **应用架构与工程**：参与 monorepo 调整，重构 Provider / AppState，整理工作区切换、主题变更与 MessageCenterHandler 等跨模块事件处理。
2. **工作区与页面组织**：负责 Workspace 管理、子页面、Pinboard、收藏、回收站和快捷搜索等功能，完善页面关系、导航路径与操作流程。
3. **设置、组件与账号交互**：重构设置中心，参与共享组件维护及 react-dnd 到 dnd-kit 的迁移，负责账号和成员邀请相关功能。
4. **编辑器核心能力**：参与剪贴板重构、内容转换与兼容修复，以及 Block / Store 边界、动态 ID、子页接口和 readonly 相关开发。
5. **Bookmark 与持续维护**：实现书签块的模型、卡片 UI、创建入口与宿主集成，处理异步更新、白板交互和 undo/redo 问题，并维护相关测试。

## 6. 验证完成与未完成的部分

已完成：匹配作者历史索引、父提交 / merge 分类、共同作者标记、关键历史代码差异、12 个代表性 AFFiNE PR 的作者 / 合并状态 / 目标分支核验，以及本人确认的三组选型理由与剪贴板复杂案例整理。

后续可补充：更多协作与复盘案例、可公开的量化结果。尚未执行：所有 533 个提交逐行审计、全部公开 URL 的逐一在线访问、历史软件安装与测试运行。知识加载、提示词及来源返回已在当前分支接入；线上生效以实际部署为准。

本次资料整理涉及根简历、项目文档和证据索引；研究缓存留在 Git 忽略的 `.artifacts/affine-research/`。原始私人资料、内部设计链接、API Key 和线上运行日志均不属于本次公开知识材料。
