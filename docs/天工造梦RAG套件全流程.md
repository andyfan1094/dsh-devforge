# 天工造梦 RAG 套件（记忆中枢）全流程

> 状态：方案已定稿，辉哥已确认发车。本文档是完整实施流程：架构、选型、数据模型、里程碑任务与验收、交付纪律、风险对策。
> **阅读口径**：本文是 RAG 套件的研发方案、里程碑和交付记录，不是当前 UI 功能清单。实现状态以[中文用户手册](用户手册.md)和源码为准；文中标为“待办/规划”的能力不代表当前页面已经提供对应控件（例如 URL 入库、评估集、HyDE）。
> 配套：Hindsight initiative 页 kp-dbf370dfa48949a5aef9fff968a789fb 持续跟踪；学习材料见工作区《RAG与工作流学习指南.md》。

## 一、目标与定位

在 dsh-devforge（天工造梦）内置完美版 RAG + 工作流套件，形成「记忆中枢」：

- 知识库：上传文档（md/txt/pdf/docx/代码/URL）与登记本机项目，自动切块、向量化、混合检索；
- 工作流：配置化 RAG 管线（改写 → 路由 → 多源检索 → 重排 → 生成 → 自评重试 → 联网兜底）；
- 会话工具：rag_search（检索）与 rag_run（跑工作流）注册给全部 DSH 会话；
- 记忆融合：Mnemon / Hindsight 以只读镜像融入统一检索（红线：不碰其写入协议）；
- 多电脑：数据入 store.db，随 CNB 加密备份跨端，向量本地重建；
- 评估：问答对评估集跑 Recall@K / MRR，调参有据。

## 二、架构总览

知识分六层，各系统各司其职，RAG 套件做统一检索层：

    越热 ① Mnemon 热记忆（runtime，主动注入，决策/偏好/教训）
        ② Mnemon Documents（结构化项目文档）
        ③ Hindsight 知识页（架构叙事/决策故事）
        ④ codebase-memory 图谱（代码骨架：架构/依赖）
        ⑤ RAG 全文库（本套件，全量原文细节）
    越冷 ⑥ 会话历史

融合原则：①-④照旧管写入与主动注入；⑤对所有源做只读镜像 + 全文检索；统一搜索与工作流多源节点做查询编排。

模块结构（沿用能力域四件套模式）：src/rag/ 下 protocol / service / routes / tools + client/panel/RagTab.tsx；连接器、切块、嵌入、检索、重排、工作流各成子模块。

## 三、技术选型（全纯 JS/TS，零原生编译依赖）

| 环节 | 选型 | 状态 |
|---|---|---|
| 混合检索引擎 | @orama/orama（BM25 全文 + 向量 + hybrid 统一 API，纯 TS） | 待动工前核实 LICENSE（预期 MIT） |
| 中文分词 | Intl.Segmenter（Node 内置 ICU）接 Orama 自定义 tokenizer | 无需依赖 |
| PDF 解析 | unpdf（pdfjs 内核封装） | 动工前装机验证 |
| DOCX 解析 | mammoth | 动工前装机验证 |
| Embedding | 智谱 embedding-3（首选，复用受管凭据）+ 硅基流动 BAAI/bge-m3（首选免费向量）+ 方舟 doubao-embedding + OpenAI 中转备选；批量 + 文本 hash 缓存防重复计费 | 端点真实调用已验证 |
| 重排 | 智谱 rerank API（/api/paas/v4/rerank，model=rerank）+ LLM 打分兜底 | 接口格式已核实 |
| 主存储 | store.db（node:sqlite）docs 域：源文档/切块/向量缓存分离 | 沿用现有 |
| 生成 | 工具回传上下文给会话模型，或走 Provider 渠道 | 沿用现有 |

## 四、数据模型（store.db docs 域，多端同步友好）

- rag.kb：知识库（名称、embedding 渠道/模型、切块参数、来源类型 manual/project/mirror）；
- rag.doc：源文档（库 id、文件名、来源路径、hash、状态、元数据）；
- rag.chunk：切块（doc id、序号、标题路径、原文、偏移、embedding 向量 BLOB、hash 缓存键）；
- rag.workflow / rag.workflow_run：工作流定义与运行历史；
- rag.eval：评估集与跑分记录；
- rag.settings：全局设置单例（向量模型/重排/切块/检索默认值，面板读写，不依赖宿主 config schema，规避暂存同 HOME 补丁无效的坑）。

设计要点：向量是派生物（可由源文档重建），跨端只同步小体积源数据；Orama 内存索引启动时从库重建。

## 五、里程碑计划（每期独立交付、独立验收）

### 阶段 0：动工前验证 ✅ 已完成（2026-09-02）

验证结论：

1. Orama LICENSE = Apache-2.0（宽松可商用，与 devforge 现有 MIT AND Apache-2.0 兼容）；分发时在 THIRD_PARTY_NOTICES.md 补一条声明；版本 3.1.18，ESM 模块。
2. 装机演练（Mac 干净环境 npm install）通过：@orama/orama + unpdf + mammoth 共 28 包 16 秒，import 全通，无原生编译。Windows 侧装机验证放到 M1 发布前（远程运维或手动）。
3. 冒烟测试证实关键预判：Orama 默认 tokenizer 对中文全文检索无效（「暂存实例」搜不中含该词的中文句），向量检索正常——M1 必须接入 Intl.Segmenter 自定义 tokenizer，这是中文 BM25 生效的前提。
4. 智谱 Coding Plan 现有凭据实测通过：/api/paas/v4/embeddings（embedding-3 正常返回向量）与 /api/paas/v4/rerank（相关性打分正确，无关文档被排掉）均可用，无需另开开放平台计费 key。
5. 数据模型按第四节 schema 在 M1 编码时定稿落库。

### M1 检索底座（核心闭环）✅ 已完成（0.14.0，2026-09-02）

交付内容：src/rag/ 八模块（segmenter/chunker/protocol/index-engine/parser/embedder/rag-store/service/routes/tools）、面板「记忆中枢」页签（库管理/文档入库/检索测试台/设置）、rag_search 会话工具、29 项单测全绿、typecheck 零错误（RAG 部分）、构建通过。中文全文检索经 Orama 自定义 tokenizer（词典+bigram）端到端验证生效。

任务：src/rag 四件套骨架；四格式解析（md/txt/代码直读 + unpdf + mammoth）；切块器（Markdown 标题感知 + 固定窗口 + 重叠）；智谱 embedding 客户端（手写 HTTP、凭据走受管凭据表、批量 + 缓存）；Orama 索引（启动重建 + 中文分词接入）；hybrid 检索 API；面板「知识库」页（库管理、上传、切块预览、检索测试台：召回列表 + 分数 + 命中高亮）；RAG 设置区（向量模型/重排/切块/检索默认参数，详见第九节配置设计）。
验收：单测全绿（切块/索引/检索/分词）；暂存实例上传真实 PDF + md，测试台检索可见召回与分数。

### M2 检索强化 ✅ 已完成（0.15.0，2026-09-02）

交付：智谱 rerank 精排接入 + LLM 打分兜底（applyRerank 失败回退原序）；多查询改写与自评重试并入工作流引擎（见 M4）；检索命中带知识库名出处（kbName）。
待办（M4b）：HyDE、引用溯源点击展开原文。

### M3 项目知识库 + 记忆中枢连接器 ✅ 主体完成（0.15.0，2026-09-02）

交付：项目自动索引（ProjectIndexer：轻量 .gitignore 匹配器 + 固定排除目录 + 内容哈希增量入库/清理，POST /rag/kb/index）；只读镜像连接器（Mnemon：全局根 runtime/MEMORY.md、USER.md、documents/active/*.md；Hindsight：~/.hindsight/coding-agent.json → /knowledge-base/tree → 逐页正文，全程零写入协议）；镜像同步路由与镜像状态端点。
待办（M4b）：统一搜索页（多源并行 + 来源徽章）。

### M4 工作流 + 多端 + 评估 + 生态 ◐ 进行中（工作流部分 0.15.0 已交付）

已交付（0.15.0）：工作流引擎（节点 DSL：改写/多源检索/精排/生成/自评重试，节点可开关可调参）+ 运行历史（保留 50 条）+ rag_run 会话工具 + 面板「工作流」页签。
待办：多端端到端（Mac 建库 → CNB 备份 → Windows 恢复 → 索引重建）；评估页（Recall@K / MRR）；服务工厂 RAG 服务模板。

### 0.16.3 Coding Plan 与稳定性补强 ✅ 已完成

- 硅基流动：Coding Plan 内提供独立页签、受管 API Key、按系列精选最新版对话模型目录同步（0.16.4 补线协议声明，0.16.5 系列精选）；RAG 直接选择硅基流动 BAAI/bge-m3（1024 维），上游已停用的余额接口不再接入。
- OpenAI 中转：保留旧版 baseURL/apiKeyEnv/imageModel 字段与 openai-gateway provider id，同时支持多个端点、独立凭据引用、分别同步模型路由和端点级生图模型；删除端点时清理对应 provider。
- 皮肤稳定性：客户端重挂载共享主题注册租约；模型选择或设置刷新造成 ThemeRuntime 短暂回到 system 时，按本地持久化选择自动恢复。

### 会话记忆层（M2.5，0.15.0 新增，辉哥需求「记忆」本体）✅ 已完成

- 自动沉淀：turn/end 事件驱动 + 60s 去抖，取最近一轮用户/助手窗口（≤9k 字符）走默认模型路由提炼候选记忆（≤5 条），规范化哈希 + 包含式双重去重后入库「会话记忆库」（source=memory）；失败只计数不扰会话。
- 主动注入：agent/pre-step 第一步检索 memory+mirror 来源库（阈值过滤、字数上限 1200），以 plugin snapshot 用户消息追加进本轮（仿 dsh-time-context）。
- 设置与状态：memory.settings 存 store.db（部分保存宽松合并）；面板「记忆工作台」页签（状态徽章/设置行/条目管理/项目索引/镜像同步）。
- 红线：Mnemon/Hindsight 写入协议零改动；提炼失败不阻塞会话；凭据零落日志。

## 六、标准交付流程（每期必须完整走）

1. 源仓库开发 + node:test 单测全绿 + typecheck 零错误；
2. 版本号递增，中文提交（只提交本次变更，git add 指定文件清单，绝不 add -A）；
3. 推远端（CNB + GitHub），官网 modagentai.com 发布（npm pack → sha256 回填 index.json → 上传三件套 → 线上核对）；
4. dsh plugin --profile web add 官网 tgz 装机；
5. 起 3081 暂存实例（隔离 HOME + 禁桌面宠物 + 禁飞书桥），辉哥人工过目；
6. 辉哥明确确认后 devforge_restart 重启生产，关停暂存实例。

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| Orama 大库性能（超 5 万切块变慢） | 数据模型保留升级空间（sqlite-vec / 分层索引），当前规模够用 |
| Mnemon / Hindsight 接口形式不确定 | 三级备选（HTTP → inject → 导出），M3 首个任务就是验证 |
| 渠道 API 变动或限额 | 渠道抽象层隔离，多渠道可切换（智谱/方舟/中转） |
| 双平台装机 | 选型已规避原生依赖；阶段 0 装机演练兜底 |
| 并行会话冲突 | 动工前 git status 复核；add 只指定文件清单；共享文件（routes/api/protocol）改动前先看远端 |
| embedding 计费 | 文本 hash 缓存，同内容不重复计费 |

## 八、配置页面设计（RAG 设置）

配置分两层：全局默认（rag.settings 单例）+ 库级覆盖（每个知识库可选「继承全局」或自定义）。全部在面板「知识库」页的设置区完成，存储走 store.db settings 域。

### 全局设置区

| 配置组 | 配置项 | 交互 |
|---|---|---|
| 向量模型 | 渠道（智谱/硅基流动/方舟/OpenAI 中转）+ 模型下拉 + 向量维度显示 + 测试连接按钮 | 切换时若已有库向量不兼容则触发守卫提示（见下） |
| 重排 | 模式（智谱 rerank / LLM 重排兜底 / 关闭）+ top_n | 默认智谱 rerank |
| 默认切块 | 策略（标题感知/固定窗口）+ 块大小 + 重叠 | 新库默认值 |
| 默认检索 | Top-K + 混合权重（向量:关键词滑条）+ 相似度阈值 | 测试台与工具共用 |
| 生成模型 | 渠道 + 模型（走现有 Provider 体系） | 工作流生成节点用 |
| 高级 | embedding 并发数 + 缓存开关 + 超时 | 缓存默认开 |

### 切换向量模型的守卫逻辑（防翻车关键）

1. 切换前检测：受影响库的已嵌向量数量；
2. 弹确认：「向量空间将不兼容，需重新索引 N 个库共 M 个切块（约 X 次调用，命中缓存不计费）」；
3. 确认后排入重嵌队列，逐库重建（进度在面板可见）；
4. 重嵌期间该库检索降级为纯关键词，完成即恢复混合。

### 多端一致性提示

设置页常驻提示条：两台电脑的向量模型配置必须一致（否则跨端恢复后向量对不上）；检测到备份恢复且配置不一致时，恢复流程中明确警示。

### 凭据状态联动

设置区顶部显示各渠道凭据状态（已配置/未配置，未配置一键跳转对应渠道页），与现有 Coding Plan 页签交互一致。

## 九、纪律红线

- Mnemon / Hindsight 写入协议零改动，只读镜像；
- 凭据只走受管凭据表，不落明文、不入日志、不入文档；硅基流动不依赖余额接口；
- 文档与提交说明全中文；不自动推送；不提交无关改动；
- 生产实例不当试验田，暂存验收不过不重启生产。