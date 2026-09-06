/**
 * 天工造梦使用指南：把账号注册、首次配置和各功能入口集中到一个可检索的浏览型页面。
 * 页面只负责静态说明与页签跳转，不读取凭据、不复制后端规则；外部链接统一新标签打开。
 */
import { useMemo, useState } from 'react'
import type { JSX, UIEvent } from 'react'
import css from './panel.module.css'

/** 教程可直接跳转的操作台页签。 */
export type GuideDestination = 'codeplan' | 'rag' | 'memory' | 'workflow' | 'mcp' | 'standards' | 'browser' | 'remote' | 'projects' | 'repos' | 'feishu' | 'pluginupdate' | 'skin'

/** 教程页属性。 */
export interface GuideTabProps {
  /** 点击操作按钮时切换到对应的操作台页签。 */
  onNavigate: (target: GuideDestination) => void
  /** 皮肤运行时为可选能力，不可用时不展示无效入口。 */
  skinAvailable: boolean
}

interface ProviderGuide {
  id: string
  name: string
  badge: string
  intro: string
  steps: string[]
  note: string
  registerUrl: string
  registerLabel: string
  docsUrl: string
  docsLabel: string
  destination?: GuideDestination
}

interface FeatureGuide {
  id: string
  category: string
  title: string
  summary: string
  bullets: string[]
  destination?: GuideDestination
  action?: string
}

type GuideSection = 'start' | 'accounts' | 'features' | 'recipes' | 'security'

const GUIDE_SECTIONS: ReadonlyArray<readonly [GuideSection, string]> = [
  ['start', '首次配置'],
  ['accounts', '账号与密钥'],
  ['features', '功能说明'],
  ['recipes', '常用操作'],
  ['security', '安全与排错'],
]

const PROVIDERS: ProviderGuide[] = [
  {
    id: 'zhipu',
    name: '智谱 GLM Coding Plan',
    badge: '推荐入门',
    intro: '使用官方 Coding Plan 模型、额度看板和智谱 MCP（联网搜索、网页读取、Zread）；支持配置多把 Key 自动容灾。',
    steps: ['打开智谱开放平台并注册、登录，按页面提示完成实名认证与 Coding Plan 订阅。', '进入「个人编程套餐 → 套餐概览」（团队成员进入「团队编程套餐 → 我的套餐」），新建 API Key；有多个账号时可各建一把。', '回到「Coding Plan → 智谱 GLM」，粘贴 Key 保存（第一把存为主 Key，其余「存为附加 Key」），再点击「完善模型接入」或「从官方拉取模型」。'],
    note: '受管凭据引用：主 Key ZAI_CODING_CN_API_KEY，附加槽位 _2…_6。官方调用在 Key 失效、限流或额度耗尽时自动换下一把；主 Key 用于聊天模型路由，可随时「设为主 Key」切换。Key 只写入 DSH 凭据存储，页面不会回显明文。',
    registerUrl: 'https://open.bigmodel.cn/',
    registerLabel: '打开智谱开放平台',
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
    docsLabel: '查看 Coding Plan 快速开始',
    destination: 'codeplan',
  },
  {
    id: 'minimax',
    name: 'MiniMax Coding Plan',
    badge: '多模态',
    intro: '提供文本、图像理解、图像生成、语音合成和视频生成工具，并展示订阅用量。',
    steps: ['打开 MiniMax 开放平台注册并登录，按需要开通国内 Token Plan/Coding Plan。', '在账号或订阅页面创建订阅 API Key；用量查询必须使用订阅 Key，不要拿普通按量 Key 代替。', '回到「Coding Plan → MiniMax」，粘贴 Key 保存，再同步模型；首次使用图片、语音或视频工具时，按提示提供对应输入。'],
    note: '受管凭据引用：MINIMAX_CN_API_KEY。国内/国际站点和 Key 要保持一致，否则可能出现鉴权失败。',
    registerUrl: 'https://platform.minimaxi.com/',
    registerLabel: '打开 MiniMax 开放平台',
    docsUrl: 'https://platform.minimax.cn/docs/guides/quickstart-preparation',
    docsLabel: '查看官方准备文档',
    destination: 'codeplan',
  },
  {
    id: 'ark',
    name: '火山方舟 Agent Plan',
    badge: '双凭据',
    intro: 'Plan Key 用于模型调用；控制面 AK/SK 用于查询 Agent Plan 与 Coding Plan 的套餐用量。',
    steps: ['登录火山方舟控制台，注册或开通 Agent Plan/Coding Plan，进入 API Key 管理创建 Plan API Key。', '在「Coding Plan → 火山方舟 → 使用配置」保存 Plan Key，并点击「同步模型与推理档位」。', '切到「用量统计」，从 IAM「访问密钥管理」创建同一账号的 Access Key / Secret Key，粘贴后点击「保存并验证」。'],
    note: 'Plan Key 与控制面 AK/SK 不是同一种凭据；只填 Plan Key 可以聊天，但不能显示用量看板。',
    registerUrl: 'https://www.volcengine.com/activity/codingplan-feishu',
    registerLabel: '打开方舟 Coding Plan',
    docsUrl: 'https://console.volcengine.com/iam/keymanage/',
    docsLabel: '打开火山访问密钥管理',
    destination: 'codeplan',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    badge: '模型目录 / 向量',
    intro: '提供 OpenAI 兼容模型目录，也可作为记忆中枢的 BAAI/bge-m3 向量渠道；不依赖余额接口。',
    steps: ['打开硅基流动平台注册并登录，在「API 密钥」页面创建 API Key。', '回到「Coding Plan → 硅基流动」，填写 Key 并保存，再同步精选最新版模型目录。', '如配置记忆中枢，进入「记忆中枢」底部设置，把向量渠道选为「硅基流动」、模型填 BAAI/bge-m3，测试连接后保存。'],
    note: '受管凭据引用：SILICONFLOW_API_KEY。模型目录随上游变化，使用前可重新同步。',
    registerUrl: 'https://cloud.siliconflow.cn/',
    registerLabel: '打开硅基流动控制台',
    docsUrl: 'https://api-docs.siliconflow.cn/docs/userguide/quickstart',
    docsLabel: '查看快速上手文档',
    destination: 'codeplan',
  },
  {
    id: 'gateway',
    name: 'OpenAI 兼容中转站',
    badge: '自定义端点',
    intro: '接入任意兼容 OpenAI Responses 或 Anthropic Messages 的中转服务，自动发现模型并可指定生图模型。',
    steps: ['先在你选择的中转服务平台注册账号、购买或申请额度，并复制 API Base URL 与 API Key。', '进入「Coding Plan → OpenAI 中转」，添加端点，填写名称、地址、受管凭据引用和协议类型。', '保存当前端点后点击「获取当前模型」；需要图片时，在「该端点的生图模型」选择模型，再回到对话使用 generate_image。'],
    note: '中转服务的注册、计费和可用模型由服务商负责；DSH 只保存受管凭据引用，不把 Key 写进 URL。',
    registerUrl: 'https://platform.openai.com/signup',
    registerLabel: '示例：打开 OpenAI 平台',
    docsUrl: 'https://platform.openai.com/docs/overview',
    docsLabel: '查看兼容接口说明',
    destination: 'codeplan',
  },
]

const FEATURES: FeatureGuide[] = [
  {
    id: 'coding-plan',
    category: '模型与额度',
    title: 'Coding Plan',
    summary: '配置智谱、MiniMax、火山方舟和硅基流动；OpenAI 兼容中转在独立子页维护。',
    bullets: ['概览汇总四家 Coding Plan 的凭据状态和 Token 用量；进入服务商页签后配置 Key、模型和推理档位。', '智谱支持多把 Key：附加 Key 在失效、限流或额度耗尽时自动顶上，主 Key 服务聊天路由可一键切换；MiniMax 可从官方同步模型；方舟的 Plan Key 与用量查询 AK/SK 需要分别配置。', 'OpenAI 中转支持多个端点和端点级生图模型。Key 保存后不会在页面回显明文。'],
    destination: 'codeplan',
    action: '打开 Coding Plan',
  },
  {
    id: 'standards',
    category: '开发效率',
    title: '开发规范与一键生成',
    summary: '让智能体先读规范再动工，减少目录、注释、日志和安全边界不一致。',
    bullets: ['「开发规范」页签可浏览 v1/common、v1/api、v1/frontend、v1/web-service 等 Markdown 规范。', '对话中说「一键生成服务」或「按规范建服务」，模型会调用 devforge_jobs；模板支持 web-service 与 frontend-app。', '也可以直接说「列出开发规范」调用 devforge_standards；生成任务由 Host 异步创建并在工作区可见。'],
    destination: 'standards',
    action: '查看开发规范',
  },
  {
    id: 'rag',
    category: '知识检索',
    title: '记忆中枢（RAG）',
    summary: '把文档变成可检索知识库，用中文全文 + 向量混合检索验证召回效果。',
    bullets: ['先创建知识库，再上传或粘贴 Markdown、文本、代码、PDF、DOCX 等资料；系统自动切块并向量化。', '在检索测试台输入问题，调整 Top-K 与向量权重，查看命中文档、标题路径和分数。', '设置区可选择智谱、硅基流动、方舟或 OpenAI 中转向量模型；更换向量模型后按提示重嵌全部切块。'],
    destination: 'rag',
    action: '打开记忆中枢',
  },
  {
    id: 'memory',
    category: '长期记忆',
    title: '记忆工作台',
    summary: '管理会话自动沉淀、每轮主动注入、用户身份卡、知识图谱和外部记忆迁移。',
    bullets: ['「用户身份卡」填写称呼、身份和习惯；常驻注入不依赖召回，每轮都能让模型知道你的固定偏好。', '打开「自动沉淀」后，会话结束时提炼值得长期保存的信息；打开「主动注入」后，每轮首步召回相关记忆。', '可手动搜索/补录/删除内置记忆，点图谱节点查看详情；Mnemon/Hindsight 仅支持只读镜像或幂等迁移，不改外部写入协议。'],
    destination: 'memory',
    action: '打开记忆工作台',
  },
  {
    id: 'workflow',
    category: '知识检索',
    title: '工作流',
    summary: '把改写、检索、精排、生成和自评重试编排成可重复运行的 RAG 管线。',
    bullets: ['点「新建默认工作流」，按需开启查询改写、合并后精排和自评重试。', '调整 Top-K、向量权重和生成参数后保存；在右侧运行台输入问题即可查看答案、来源和每步耗时。', '运行记录保留最近历史，适合比较参数调整前后的召回与生成效果。'],
    destination: 'workflow',
    action: '打开工作流',
  },
  {
    id: 'mcp',
    category: '外部工具',
    title: 'MCP 服务器',
    summary: '通过 stdio 本地进程或 Streamable HTTP 服务向模型注册外部工具。',
    bullets: ['添加服务器时设置唯一 serverName；公开工具名为 mcp__<serverName>__<tool>。', 'stdio 填命令、参数、工作目录和环境变量；HTTP 填 URL 与请求头。敏感值只显示配置状态，编辑时留空会保留原值。', '可先测试当前表单。保存后立即挂载，无需重启；连接异常时使用「重载全部」。'],
    destination: 'mcp',
    action: '打开 MCP',
  },
  {
    id: 'projects',
    category: '项目管理',
    title: '项目与产出公约',
    summary: '登记项目路径、仓库和发布目标，让模型在正确项目上下文和目录规范中工作。',
    bullets: ['新建项目填写名称、绝对路径、描述、CNB/GitHub 仓库、分支和 SSH/WinRM 发布目标。', '「扫描登记」会扫描常用代码根；「检测仓库」读取 .git 元数据；路径换电脑后使用「重定位」或自动匹配。', '「产出公约」把项目、临时文件、脚本、下载、备份、产出、笔记分到固定目录；模型可调用 devforge_project 与 devforge_workspace。'],
    destination: 'projects',
    action: '打开项目管理',
  },
  {
    id: 'repos',
    category: '代码托管',
    title: 'CNB / GitHub 与本地 Git',
    summary: '在一个工作台维护账号、仓库、Clone/Pull/Commit/Push，并把危险的推送动作默认关掉。',
    bullets: ['先在「账号」保存别名和令牌，再用「验证」确认用户名；令牌只写不读，列表不会回显明文。', '「仓库」可查询我的仓库并一键带入 Clone 参数；「本地 Git」支持 Status、Clone、Pull、Commit、Push。', '「安全设置」里显式开启 Allow push 后才允许推送；Force Push 还需要单独授权。CNB 只支持 HTTPS + 令牌，用户名固定为 cnb。'],
    destination: 'repos',
    action: '打开代码仓库',
  },
  {
    id: 'backup',
    category: '数据安全',
    title: 'CNB 加密备份与跨机同步',
    summary: '把 store.db 与飞书配置加密后存入 CNB 私密仓库，换电脑可预览后恢复。',
    bullets: ['进入「代码仓库 → CNB → 加密备份」，选择 CNB 账号、私密仓库、6 位密码和同步间隔，再启用自动同步。', '「立即备份」用于手动推送；「查看远端备份」只读清单；恢复或同步前先输入密码预览文件与来源机器。', '确认恢复会覆盖本机配置，但覆盖前会自动保留 *.pre-restore.bak；恢复完成后必须重启 DSH 才全部生效。'],
    destination: 'repos',
    action: '打开代码仓库',
  },
  {
    id: 'remote',
    category: '运维自动化',
    title: '远程运维（SSH / WinRM）',
    summary: '统一维护 Linux/Unix 与 Windows 主机，供智能体执行命令、传输文件和发布项目。',
    bullets: ['在「远程运维」新增主机：选择 SSH 或 WinRM，填写别名、主机、端口、用户和认证方式；凭据不会出现在主机摘要。', 'SSH 支持密码、私钥文件、SSH Agent；WinRM 使用密码，可按 5985/5986 选择 HTTP/HTTPS。', '面板负责脱敏主机清单；实际 ssh_exec、ssh_upload、ssh_download、winrm_exec 等操作由对应 Agent 工具按用户请求执行。'],
    destination: 'remote',
    action: '打开远程运维',
  },
  {
    id: 'feishu',
    category: '协作入口',
    title: '飞书智能体',
    summary: '把 DSH 智能体接入飞书长连接，用独立会话处理消息并可发送完成通知。',
    bullets: ['在飞书开放平台创建企业自建应用，复制 App ID 和 App Secret；在应用权限与事件订阅中按官方文档完成配置、发布应用。', '回到「飞书」页填写 App ID/Secret、独立会话工作目录、允许的 open_id、群聊响应模式和 Agent 预设。', '先「测试连接」再保存；应用密钥只单向提交，状态区只显示掩码。暂存实例必须关闭飞书桥，避免与生产长连接抢事件。'],
    destination: 'feishu',
    action: '打开飞书配置',
  },
  {
    id: 'browser',
    category: '可见自动化',
    title: '可见运营浏览器',
    summary: '使用本机前台 Chrome 的持久用户档案，不开隐形浏览器，适合登录后继续操作。',
    bullets: ['先在设置中启用本地浏览器；面板可打开 URL、读取无障碍快照、截图和停止浏览器。', 'browser_tabs 管理多标签页，browser_snapshot/browser_click/browser_type 按稳定引用操作，browser_upload 安全上传图片。', '闲鱼消息读取、回复和商品发布使用独立标签页；真实回复/发布必须绑定联系人或传入确认发布，避免误操作。'],
    destination: 'browser',
    action: '打开浏览器面板',
  },
  {
    id: 'content-operations',
    category: '可见自动化',
    title: '闲鱼与小红书',
    summary: '复用已登录的前台浏览器读取闲鱼消息，并在确认后回复或发布内容。',
    bullets: ['读取闲鱼会话不会发消息；打开未读会话会产生已读状态。', '回复必须确认联系人和完整正文；发布闲鱼商品或小红书笔记必须明确确认发布。', '发布前复核当前账号、价格、标题、正文和图片，完成后关闭闲置标签页。'],
    destination: 'browser',
    action: '打开浏览器面板',
  },
  {
    id: 'minimax-hub',
    category: '多媒体生成',
    title: 'MiniMax Hub',
    summary: '调用本机已登录的 MiniMax Hub 生成图片或 H3 视频，完成后自动落盘。',
    bullets: ['Hub 必须已登录并运行；图片默认使用 banana_2，视频可选 MiniMax-H3 或 MiniMax-H3-Max。', '视频支持参考图、首尾帧和续写，时长通常为 4–15 秒；单次生成可能等待 5–30 分钟。', 'Hub 桌面网关与 Coding Plan 官方 API 是独立通道；不确定参数时先查询 Hub 能力。'],
  },
  {
    id: 'capability-injection',
    category: '智能体上下文',
    title: '项目约束与能力注入',
    summary: '把当前项目、开发约束、产出目录和已安装工具能力提供给会话。',
    bullets: ['项目登记提供本机路径、仓库和发布目标；触发开发行为后会注入完整暂存测试约束。', '项目、临时文件、脚本、下载、备份、交付物和笔记分别放入约定目录，避免散落在工作区根目录。', '插件装卸或启停后，可用能力清单随运行时更新；发送、发布、推送和重启仍遵循各工具的确认规则。'],
  },
  {
    id: 'skin',
    category: '界面体验',
    title: '皮肤与全局外观',
    summary: '整套 DSH Web GUI 换肤，支持浅深主题、强调色和可选壁纸，偏好自动保存。',
    bullets: ['选择内置主题后会同步浅色/深色 token；可单独选择强调色或输入自定义颜色。', '壁纸支持本地图片或 http(s)/data:image 地址，可调遮罩、模糊和铺放方式；单张本地图片建议不超过 1.8 MB。', '所有交互都有错误提示；遇到主题恢复异常可点「恢复默认」，不影响会话和模型配置。'],
    destination: 'skin',
    action: '打开皮肤设置',
  },
  {
    id: 'updates',
    category: '维护',
    title: '插件更新与 DSH 本体',
    summary: '检查 dsh-devforge 官网/GitHub 版本和 DSH 官方 Tags，升级后按提示重启生效。',
    bullets: ['打开「插件更新」查看本机版本、最新版本和更新来源；插件升级会走下载、校验和 dsh plugin add 流程。', 'DSH 本体只提供官方版本和升级命令，不在插件内替换宿主进程；复制命令到终端执行。', '升级完成后点设置旁的重启入口；重启是破坏性动作，只有你明确要求时才执行。'],
    destination: 'pluginupdate',
    action: '打开更新检查',
  },
]

/** 当前 Web profile 中已挂载的其它扩展；这些入口不属于天工造梦页签，
 * 因此在教程中说明真实入口位置，不伪造一个不存在的跳转按钮。 */
const INSTALLED_EXTENSIONS: FeatureGuide[] = [
  {
    id: 'task-board',
    category: '已安装扩展',
    title: '任务看板',
    summary: '用多列看板管理一次性或定时任务，浏览器关闭后仍由 Host 继续执行和结算。',
    bullets: ['从左侧「任务看板」进入，创建任务时可钉住工作区、Agent 预设和权限；详情页查看运行记录。', '定时任务使用本机时区的 5 段 cron，错过的触发点不会补跑；空闲系统睡眠保护默认关闭。', '任务执行会消耗模型额度；涉及发布、删除或外部写操作时，先在任务详情确认范围。'],
  },
  {
    id: 'git-graph',
    category: '已安装扩展',
    title: 'Git Graph 与 Worktree',
    summary: '在空白会话输入区查看分支、切换/创建分支，并用隔离 worktree 开新会话。',
    bullets: ['在空白会话的输入区打开分支选择器，可查看 Git graph、切换或创建分支。', '需要并行开发时创建 worktree，再为 worktree 打开独立会话；完成后在面板管理和清理。', '自动隔离和 git_worktree 工具属于可选能力，操作前确认当前仓库和目标目录。'],
  },
  {
    id: 'better-sidebar',
    category: '已安装扩展',
    title: 'Better Sidebar 工作台',
    summary: '在会话右侧或底部打开文件树、编辑器、Markdown/Mermaid、PDF、图片、浏览器和终端。',
    bullets: ['从右侧栏/底部工作台选择对应工具 Tab；文件查看器适合快速预览，编辑器适合小范围修改。', 'Git diff、历史、暂存提交和后台任务集中在同一侧栏，侧边对话可辅助当前文件。', '真实终端与 Git 写操作仍会改变本机文件或仓库，执行前确认路径和命令。'],
  },
  {
    id: 'context',
    category: '已安装扩展',
    title: '上下文观测',
    summary: '查看 token、组成、趋势、事件、文件活动和 Agent 网络，定位上下文为什么变长或变慢。',
    bullets: ['从侧边栏「上下文」或会话中的 context 入口打开；先看 stats，再按需要查看 composition、trend 和 events。', '文件活动和 Agent 网络用于排查当前会话读写了哪些内容、产生了哪些协作链路。', '它是观测工具，不会替代记忆中枢；要管理长期知识请回到「记忆工作台」。'],
  },
  {
    id: 'file-upload',
    category: '已安装扩展',
    title: '文件上传与语音输入',
    summary: '通过输入框回形针或全局拖拽添加附件，支持文档解析、图片 OCR、语音输入和音频转写。',
    bullets: ['点击输入框回形针或把文件拖入页面；常见 PDF、DOCX、PPTX、XLSX、HTML、CSV、JSON、图片和压缩包会进入解析流程。', '图片会走 OCR，音频可走 ASR；解析后的内容以附件形式交给当前会话，适合让模型总结或提取字段。', '上传前检查文件是否包含敏感信息；大文件或不支持格式会在页面提示失败原因。'],
  },
  {
    id: 'univer',
    category: '已安装扩展',
    title: 'Univer Office 文档工作台',
    summary: '用自然语言创建和编辑 Sheet、Doc、Slide、Base、Board，并支持跨 Unit 引用与 Office 导入导出。',
    bullets: ['直接说「创建一个表格/文档/幻灯片/画板」，或使用 univer_new、univer_import 等工具开始。', '复杂修改先在隔离草稿中预览和 lint，再选择合并；需要精确内容时用 inspect，避免误改整份文档。', '可导入/导出 xlsx、csv、docx、pptx 等格式；跨 Unit 公式和引用先确认目标 Unit。'],
  },
  {
    id: 'dshmarket',
    category: '已安装扩展',
    title: '插件市场',
    summary: '从设置 → 插件市场发现、安装、更新、卸载和备份社区插件，并查看诊断信息。',
    bullets: ['打开 DSH 设置，在「插件市场」按分类或关键词搜索；查看描述、截图、评分和评论后再安装。', '插件安装/更新/卸载会改变当前 Web profile 的能力，操作前确认来源、权限和兼容版本。', '遇到加载问题先看市场诊断与加载顺序；需要迁移时使用市场提供的备份/恢复入口。'],
  },
  {
    id: 'modsearch',
    category: '已安装扩展',
    title: '联网搜索与网页读取',
    summary: 'modsearch 为模型提供 web search、X search、page fetch 等联网能力，搜索结果需要结合来源判断。',
    bullets: ['在对话中直接提出需要最新资料的问题，或明确说「联网搜索」「读取这个网页」「搜索 X 上的讨论」。', '读取指定 URL 时优先使用网页读取；引用结论时保留来源链接，不把搜索摘要当成唯一事实依据。', '联网能力受上游引擎和额度影响；引擎失败时应接受降级提示，不要反复盲目重试。'],
  },
]

const ALL_FEATURES: FeatureGuide[] = [...FEATURES, ...INSTALLED_EXTENSIONS]

const RECIPES = [
  { title: '第一次只想聊天', text: '先把任意一家 Coding Plan 配好 → 回到 DSH 模型选择器选模型 → 发一句简单问题验证。记忆、仓库和飞书都可以后配。', target: 'codeplan' as GuideDestination },
  { title: '让模型读懂项目', text: '先在「项目」登记或扫描 → 在「记忆工作台」输入绝对路径做项目知识索引 → 需要复杂问答时在「工作流」运行并查看来源。', target: 'projects' as GuideDestination },
  { title: '换电脑继续工作', text: 'CNB 账号与私密仓库 → 加密备份 → 新电脑安装同款插件 → 加密备份页预览/同步 → 确认后重启 DSH。两台电脑的向量配置要保持一致。', target: 'repos' as GuideDestination },
  { title: '把任务交给飞书', text: '创建并发布飞书企业自建应用 → 配置 App ID/Secret 与允许用户 → 测试连接 → 在飞书中发送消息；电脑端完成通知可单独开启。', target: 'feishu' as GuideDestination },
]

function ExternalLink(props: { href: string; children: string }): JSX.Element {
  return <a className={css['link']} href={props.href} target="_blank" rel="noopener noreferrer">{props.children} ↗</a>
}

/** 教程页：静态内容优先，搜索只过滤功能说明，不触发任何网络请求。 */
export function GuideTab({ onNavigate, skinAvailable }: GuideTabProps): JSX.Element {
  const [section, setSection] = useState<GuideSection>('start')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const availableFeatures = useMemo(() => skinAvailable ? ALL_FEATURES : ALL_FEATURES.filter((feature) => feature.id !== 'skin'), [skinAvailable])
  const visibleFeatures = useMemo(() => {
    if (normalizedQuery === '') return availableFeatures
    return availableFeatures.filter((feature) => [feature.category, feature.title, feature.summary, ...feature.bullets].join(' ').toLocaleLowerCase().includes(normalizedQuery))
  }, [availableFeatures, normalizedQuery])

  const jump = (target: GuideDestination): void => { onNavigate(target) }
  const selectSection = (next: GuideSection): void => {
    setSection(next)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    document.getElementById('dsh-devforge-guide-' + next)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }
  const syncSectionFromScroll = (event: UIEvent<HTMLElement>): void => {
    const container = event.currentTarget
    const threshold = container.getBoundingClientRect().top + 56
    let active: GuideSection = 'start'
    for (const [id] of GUIDE_SECTIONS) {
      const element = container.querySelector<HTMLElement>('#dsh-devforge-guide-' + id)
      if (element !== null && element.getBoundingClientRect().top <= threshold) active = id
    }
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) active = 'security'
    if (active !== section) setSection(active)
  }

  return (
    <section className={css['guideWorkspace']} data-dsh-part="guide-tab" aria-label="天工造梦使用说明" onScroll={syncSectionFromScroll}>
      <header className={css['guideHero']}>
        <div className={css['guideHeroCopy']}>
          <span className={css['guideKicker']}>天工造梦</span>
          <h2 className={css['guideTitle']}>使用说明</h2>
          <p className={css['guideLead']}>先配置一个模型，再按需设置记忆、项目、代码仓库、远程运维和飞书。带「打开」按钮的项目会切换到对应顶层页签。</p>
        </div>
        <div className={css['guideHeroActions']}>
          <button type="button" className={css['primaryButton']} onClick={() => jump('codeplan')}>配置模型</button>
          <button type="button" className={css['ghostButton']} onClick={() => selectSection('features')}>查看功能</button>
        </div>
      </header>

      <nav className={css['guideNav']} aria-label="教程目录">
        {GUIDE_SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className={css['guideNavButton']} data-active={section === id ? '' : undefined} aria-current={section === id ? 'location' : undefined} onClick={() => selectSection(id)}>{label}</button>
        ))}
      </nav>

      <div className={css['guideContent']}>
        <section id="dsh-devforge-guide-start" className={css['guideSection']}>
          <div className={css['guideSectionHeader']}>
            <div><span className={css['guideEyebrow']}>01 · 开始</span><h3 className={css['guideSectionTitle']}>首次配置</h3><p className={css['guideSectionCopy']}>天工造梦运行在本机 DSH Web 中，不需要单独注册账号。使用模型或外部服务时，再注册对应平台账号。</p></div>
          </div>
          <div className={css['guideSteps']}>
            <article className={css['guideStep']}><span className={css['guideStepNumber']}>01</span><strong>打开操作台</strong><p>在左侧点击「天工造梦」。教程就在第一个页签，所有配置页签也从这里进入。</p></article>
            <article className={css['guideStep']}><span className={css['guideStepNumber']}>02</span><strong>准备一个模型账号</strong><p>从下方选择智谱、MiniMax、火山方舟、硅基流动或兼容中转站，注册并创建对应密钥。</p></article>
            <article className={css['guideStep']}><span className={css['guideStepNumber']}>03</span><strong>保存并同步模型</strong><p>进入 Coding Plan 保存 Key，再点击对应的模型同步按钮；回到对话模型选择器即可使用。</p></article>
            <article className={css['guideStep']}><span className={css['guideStepNumber']}>04</span><strong>按需扩展能力</strong><p>想让模型记住项目就用记忆中枢；想接代码或服务器就配置仓库、远程主机；想手机聊天就接飞书。</p></article>
          </div>
          <div className={css['guideCallout']} data-kind="info"><strong>配置顺序</strong><span>模型 → 记忆中枢 → 项目 → 代码仓库 → 远程运维 → 飞书。每配置一项先确认能正常使用，再继续下一项。</span></div>
        </section>

        <section id="dsh-devforge-guide-accounts" className={css['guideSection']}>
          <div className={css['guideSectionHeader']}>
            <div><span className={css['guideEyebrow']}>02 · 注册账号</span><h3 className={css['guideSectionTitle']}>平台注册、取 Key、回到面板配置</h3><p className={css['guideSectionCopy']}>下面的入口均来自对应平台官方站点。注册页面、套餐名称和价格可能变化；以平台当前页面为准，不要把密钥发到聊天或提交到仓库。</p></div>
          </div>
          <div className={css['providerGrid']}>
            {PROVIDERS.map((provider) => (
              <article key={provider.id} className={css['providerCard']}>
                <div className={css['providerHeader']}><div><span className={css['guideEyebrow']}>{provider.id === 'gateway' ? '兼容接入' : 'Coding Plan'}</span><h4>{provider.name}</h4></div><span className={css['guideBadge']}>{provider.badge}</span></div>
                <p className={css['providerIntro']}>{provider.intro}</p>
                <ol className={css['providerSteps']}>{provider.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                <p className={css['providerNote']}>{provider.note}</p>
                <div className={css['guideActions']}><ExternalLink href={provider.registerUrl}>{provider.registerLabel}</ExternalLink><ExternalLink href={provider.docsUrl}>{provider.docsLabel}</ExternalLink>{provider.destination !== undefined && <button type="button" className={css['ghostButton']} onClick={() => jump(provider.destination as GuideDestination)}>打开 Coding Plan</button>}</div>
              </article>
            ))}
          </div>
          <div className={css['accountMiniGrid']}>
            <article className={css['accountMiniCard']}><strong>GitHub 账号</strong><span>注册 GitHub 后，在 Developer settings → Personal access tokens 创建 fine-grained Token；面板入口：代码仓库 → GitHub → 账号。</span><ExternalLink href="https://github.com/signup">注册 GitHub</ExternalLink></article>
            <article className={css['accountMiniCard']}><strong>CNB 账号</strong><span>登录 cnb.cool，在个人设置 → 访问令牌创建 Token；CNB Git 只支持 HTTPS，用户名固定为 cnb。</span><ExternalLink href="https://cnb.cool">注册 / 登录 CNB</ExternalLink></article>
            <article className={css['accountMiniCard']}><strong>飞书应用</strong><span>这不是个人 API Key，而是企业自建应用的 App ID + App Secret；创建后还要配置权限、事件订阅并发布应用。</span><ExternalLink href="https://open.feishu.cn/app?lang=zh-CN">打开飞书开发者后台</ExternalLink></article>
          </div>
        </section>

        <section id="dsh-devforge-guide-features" className={css['guideSection']}>
          <div className={css['guideSectionHeader']}>
            <div><span className={css['guideEyebrow']}>03 · 功能</span><h3 className={css['guideSectionTitle']}>功能说明</h3><p className={css['guideSectionCopy']}>按关键词筛选并展开条目。「打开」只切换到对应顶层页签，不会定位到页签内的子页面。</p></div>
            <label className={css['guideSearch']}><span className={css['srOnly']}>搜索功能</span><input className={css['input']} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索：记忆、飞书、备份、模型…" /></label>
          </div>
          {visibleFeatures.length === 0 ? <div className={css['empty']}>没有匹配的功能。试试「模型」「项目」「密钥」或「备份」。</div> : <div className={css['featureDirectory']}>
            {visibleFeatures.map((feature) => (
              <details key={feature.id} className={css['featureRow']}>
                <summary className={css['featureRowSummary']}>
                  <span className={css['featureRowCategory']}>{feature.category}</span>
                  <strong>{feature.title}</strong>
                  <span className={css['featureSummary']}>{feature.summary}</span>
                </summary>
                <div className={css['featureRowDetail']}>
                  <ul className={css['featureList']}>{feature.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
                  {feature.destination !== undefined && <button type="button" className={css['featureAction']} onClick={() => jump(feature.destination as GuideDestination)}>{feature.action ?? '打开功能'} <span aria-hidden="true">→</span></button>}
                </div>
              </details>
            ))}
          </div>}
        </section>

        <section id="dsh-devforge-guide-recipes" className={css['guideSection']}>
          <div className={css['guideSectionHeader']}><div><span className={css['guideEyebrow']}>04 · 操作顺序</span><h3 className={css['guideSectionTitle']}>常用操作</h3><p className={css['guideSectionCopy']}>按目标配置必要项目，不必一次填完所有密钥和权限。</p></div></div>
          <div className={css['recipeGrid']}>
            {RECIPES.map((recipe, index) => <article key={recipe.title} className={css['recipeCard']}><span className={css['guideStepNumber']}>0{index + 1}</span><div><h4>{recipe.title}</h4><p>{recipe.text}</p><button type="button" className={css['featureAction']} onClick={() => jump(recipe.target)}>去相关页面 →</button></div></article>)}
          </div>
        </section>

        <section id="dsh-devforge-guide-security" className={css['guideSection']}>
          <div className={css['guideSectionHeader']}><div><span className={css['guideEyebrow']}>05 · 安全与排错</span><h3 className={css['guideSectionTitle']}>遇到问题先看这里</h3></div></div>
          <div className={css['securityGrid']}>
            <article className={css['securityCard']}><strong>密钥安全吗？</strong><p>模型 Key、Git Token、飞书 App Secret、SSH 密码和备份密码都只通过本机 Host 的受管路径保存；页面只显示「已配置」或掩码。Git 操作使用临时认证头，不把 Token 写进 URL。</p></article>
            <article className={css['securityCard']}><strong>保存后模型没出现？</strong><p>确认 Key 对应套餐、点击「同步模型」或「从官方拉取模型」，再回到对话模型选择器。MiniMax 用量必须用订阅 Key；方舟用量还要另配 AK/SK。</p></article>
            <article className={css['securityCard']}><strong>记忆检索没有结果？</strong><p>先确认知识库有文档且状态为 ready，再在「记忆中枢」测试台检索；更换 embedding 模型后必须按提示重嵌。项目索引填写本机绝对路径，并尊重 .gitignore。</p></article>
            <article className={css['securityCard']}><strong>换电脑或升级后怎么办？</strong><p>跨机用 CNB 加密备份预览后同步，保持两台机器的向量配置一致；插件更新或恢复配置后按照提示重启 DSH。生产实例不要直接拿来试验。</p></article>
          </div>
          <div className={css['guideCallout']} data-kind="warning"><strong>生产安全红线</strong><span>暂存验证必须使用隔离 HOME、3081 端口，并禁用桌面宠物和飞书桥；重启生产 DSH 只在你明确确认后执行。本页不会触发重启。</span></div>
        </section>
      </div>
    </section>
  )
}
