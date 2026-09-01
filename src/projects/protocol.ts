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
  /** 本机项目绝对路径。 */
  path: string
  /** 项目描述。 */
  description: string
  /** 对应仓库类型。 */
  repoKind: RepoKind
  /** 仓库远端地址（origin 优先）。 */
  repoUrl: string
  /** 仓库当前分支（检测可得，可留空）。 */
  repoBranch: string
  /** 发布对应的服务器列表。 */
  deployTargets: DeployTarget[]
  /** 创建时间（毫秒）。 */
  createdAt: number
  /** 更新时间（毫秒）。 */
  updatedAt: number
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
