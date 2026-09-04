/**
 * 项目面板协议 —— 本机项目登记（路径 / 描述 / 代码仓库 / 发布服务器）。
 *
 * 项目面板是天工造梦操作台「项目」页签的数据契约：登记本机维护的项目，
 * 记录项目路径、项目描述、对应 Git 托管仓库（CNB / GitHub / 其他 Git）
 * 以及发布对应的服务器（关联远程运维 SSH/WinRM 主机别名）。
 */

/** /api/dsh-devforge 项目面板路由族。 */
export const PROJECTS_API = {
  /** 项目清单（GET）与保存（POST）。 */
  projects: '/api/dsh-devforge/projects',
  /** 单项目删除（DELETE，?id=）。 */
  projectItem: '/api/dsh-devforge/projects/item',
  /** 路径检测（GET，?path=）：识别 Git 仓库、远端与分支。 */
  projectDetect: '/api/dsh-devforge/projects/detect',
  /** 目录扫描（GET，?roots=逗号分隔，缺省用默认根）：发现未登记的 Git 仓库。 */
  projectScan: '/api/dsh-devforge/projects/scan',
  /** 分支刷新（POST）：对全部登记项目重跑检测，回填仓库元数据。 */
  projectRefresh: '/api/dsh-devforge/projects/refresh',
  /** 描述提取（GET，?path=）：从 package.json / README 提取建议描述。 */
  projectDescribe: '/api/dsh-devforge/projects/describe',
  /** 重定位（POST {id, path}）：把本机路径映射更新为新路径（跨机恢复后用）。 */
  projectRelocate: '/api/dsh-devforge/projects/relocate',
  /** 自动匹配（GET）：在本机常见代码根里为失效路径找候选目录。 */
  projectAutomatch: '/api/dsh-devforge/projects/automatch',
} as const

/** 代码仓库托管类型。 */
export type RepoKind = 'none' | 'cnb' | 'github' | 'git'

/** 发布服务器目标（关联远程运维主机别名，不含任何凭据）。 */
export interface DeployTarget {
  /** 远程运维通道类型。 */
  transport: 'ssh' | 'winrm'
  /** 远程运维主机别名。 */
  alias: string
}

/** 项目登记条目。 */
export interface ProjectEntry {
  /** 域内唯一 id。 */
  id: string
  /** 项目名称。 */
  name: string
  /**
   * 本机项目绝对路径（「最近一次写入时的那台机器」的路径）。
   * 多端同步后应优先看 machinePaths 里本机 machineId 的映射；
   * 读取时 store 层已自动完成该替换，本字段对调用方恒为「本机当前路径」。
   */
  path: string
  /** 各机器的本机路径映射（machineId → 绝对路径），跨机同步与重定位的依据。 */
  machinePaths: Record<string, string>
  /** 项目描述。 */
  description: string
  /** 对应仓库类型。 */
  repoKind: RepoKind
  /** 仓库远端地址（origin 优先）。 */
  repoUrl: string
  /** 仓库当前分支（检测可得，可留空）。 */
  repoBranch: string
  /** 线上地址（项目发布后的访问网址，可留空）。 */
  siteUrl: string
  /** 发布对应的服务器列表。 */
  deployTargets: DeployTarget[]
  /** 创建时间（毫秒）。 */
  createdAt: number
  /** 更新时间（毫秒）。 */
  updatedAt: number
  /** 本机路径当前是否存在（列表返回时动态 stat，不落库；缺省视为未知）。 */
  pathExists?: boolean
}

/** 扫描发现的一个候选项目目录。 */
export interface ScannedProject {
  /** 候选目录绝对路径。 */
  path: string
  /** 默认项目名（目录名）。 */
  name: string
  /** 该目录的 Git 检测结果。 */
  detect: ProjectDetectResult
  /** 已登记的项目 id（按本机路径对上登记表时回填；未登记为 undefined）。 */
  registeredId?: string
}

/** 目录扫描结果。 */
export interface ProjectScanResult {
  /** 实际扫描的根目录（存在且为目录的）。 */
  roots: string[]
  /** 发现的候选项目（按路径排序）。 */
  found: ScannedProject[]
  /** 扫描失败原因（全部根都不存在等）。 */
  error?: string
}

/** 项目描述提取结果。 */
export interface ProjectDescribeResult {
  /** 是否提取到内容。 */
  ok: boolean
  /** 来源文件（package.json / README.md 等）。 */
  source?: string
  /** 提取的描述文本（已截断）。 */
  description?: string
  /** 失败原因。 */
  error?: string
}

/** 重定位结果。 */
export interface ProjectRelocateResult {
  /** 重定位是否成功（路径存在即可成功）。 */
  ok: boolean
  /** 失败原因。 */
  error?: string
  /** 仓库不匹配警告（新路径的 origin 远端与登记 repoUrl 不一致时提示，不阻塞）。 */
  warn?: string
}

/** 失效项目的自动匹配建议（跨机恢复后为本机找候选目录）。 */
export interface AutomatchSuggestion {
  /** 登记项目 id。 */
  id: string
  /** 项目名称。 */
  name: string
  /** 登记的仓库地址（强校验依据）。 */
  repoUrl: string
  /** 本机匹配到的候选目录绝对路径。 */
  candidatePath: string
}

/** 检测到的单个远端。 */
export interface DetectedRemote {
  /** 远端名（origin 等）。 */
  name: string
  /** 远端 URL。 */
  url: string
  /** 依据 URL 识别的托管类型。 */
  kind: RepoKind
}

/** 项目路径检测结果。 */
export interface ProjectDetectResult {
  /** 检测流程本身是否完成（不等于路径有效）。 */
  ok: boolean
  /** 路径是否存在且为目录。 */
  exists: boolean
  /** 是否为 Git 仓库（.git 目录或 worktree 指针）。 */
  isGitRepo: boolean
  /** 默认项目名（目录名）。 */
  name?: string
  /** 当前分支（.git/HEAD）。 */
  branch?: string
  /** 全部远端（origin 排最前）。 */
  remotes: DetectedRemote[]
  /** 检测失败原因（路径不存在等）。 */
  error?: string
}
