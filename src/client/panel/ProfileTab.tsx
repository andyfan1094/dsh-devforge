/**
 * 个人中心 —— 页面只有一张「身份卡」（辉哥 2026-09-23 定稿 + 同日两轮迭代：名片式排版）。
 * ① 官网账号身份：头像/性别/生日存官网 modagentai.com 关联账号（GET/POST /api/auth/profile，
 *    Bearer 令牌鉴权）；未登录（或会话失效）时卡内嵌极简登录表单（登录即自动配置中转）。
 *    展示态元信息一行小字（性别 · 生日），点「编辑资料」才展开编辑控件，头像 56px 点击即换。
 * ② 插件内身份：称呼/身份简介/习惯与硬偏好（store.db memory.profile 单例，每轮常驻注入），
 *    编辑跳记忆工作台。两层身份同卡展示，官网层不依赖登录也照常显示插件身份段。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { MemoryUserProfile } from '../../memory/profile.ts'
import type { ModagentaiProfile } from '../../modagentai/protocol.ts'
import { extractPackageRows, type PackageRow } from '../zhipu-quota-core.ts'
import css from './panel.module.css'

/** 到期时间的紧凑展示：只取日期部分（2026-09-30T... → 2026-09-30）。 */
function expiryLabel(expiresAt: string | undefined): string {
  if (expiresAt === undefined || expiresAt === '') return ''
  return expiresAt.slice(0, 10)
}

/** 我的套餐卡（辉哥 2026-09-26 定稿；2026-09-28 改口径：还没用过的也要显示）：
 * 在用的 + 未激活的（带「未激活」徽章与「首次使用后 N 天内有效」）都列；已耗尽的仍不显示，不做购买目录；
 * 每行套餐名 + 剩余/总量 + 进度条（≤15% 红 / ≤40% 琥珀）+ 到期日；底部一行余额与可搜次数。 */
function MyPackages(): JSX.Element | null {
  const [rows, setRows] = useState<PackageRow[] | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/dsh-devforge/modagentai/packages')
        if (!response.ok) throw new Error('HTTP ' + String(response.status))
        const payload = await response.json() as unknown
        setRows(extractPackageRows(payload, 12))
        const view = payload !== null && typeof payload === 'object' ? (payload as { packages?: { balance?: unknown; searchesLeft?: unknown } }).packages : undefined
        setBalance(view !== undefined && typeof view.balance === 'number' ? view.balance : null)
        setSearchesLeft(view !== undefined && typeof view.searchesLeft === 'number' ? view.searchesLeft : null)
      } catch {
        setRows([])
      }
    })()
  }, [])

  if (rows === null) return null
  if (rows.length === 0 && balance === null) return null
  return (
    <div className={css['identityCard']}>
      <span className={css['identitySectionTitle']}>我的套餐</span>
      {rows.map((row) => {
        const level = row.percent <= 15 ? 'danger' : row.percent <= 40 ? 'warning' : 'normal'
        const expiry = expiryLabel(row.expiresAt)
        return (
          <div key={row.rowKey} className={css['packRow']}>
            <div className={css['packRowTop']}>
              <span className={css['packName']} title={row.title}>
                {row.label}
                {!row.activated && <span className={css['packPending']}>未激活</span>}
                {expiry !== '' ? <span className={css['packExpiry']}> · {expiry} 到期</span> : null}
              </span>
              <span className={css['packQuota']}>{row.gemsLeft} / {row.gemsTotal} 💎</span>
            </div>
            <div className={css['packBar']}>
              <div className={css['packBarFill']} data-level={level} style={{ width: Math.max(2, Math.round(row.percent)) + '%' }} />
            </div>
            {row.pendingHint !== '' && <span className={css['packHint']}>{row.pendingHint}</span>}
          </div>
        )
      })}
      {rows.length === 0 && <span className={css['identityHint']}>暂无套餐</span>}
      {balance !== null && (
        <span className={css['identityHint']}>当前余额 {balance} 💎{searchesLeft !== null ? ' ≈ ' + searchesLeft + ' 次联网搜索（约 0.1💎/次）' : ''}</span>
      )}
    </div>
  )
}

/** 个人中心属性：onNavigate 供「编辑身份」跳记忆工作台等页签（CodePlan 仅管理员可达，判断在面板侧）。 */
export interface ProfileTabProps {
  api: DevforgeApi
  onNavigate: (tab: 'codeplan' | 'memory' | 'feishu' | 'pluginupdate') => void
}

/** 性别下拉选项：控件值 ↔ 官网枚举（'' = 未设置）。 */
const GENDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '未设置' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'secret', label: '保密' },
]

/** 头像上传压缩目标边长（官网存 dataURL，128×128 在缩小显示下依然清晰）。 */
const AVATAR_SIZE = 128

/** 把图片文件 cover 居中裁剪缩放成 128×128 JPEG dataURL（官网限 150KB，质量 0.85）。 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('画布初始化失败')
    // cover 裁剪：短边贴满画布，长边居中裁掉
    const scale = Math.max(AVATAR_SIZE / image.naturalWidth, AVATAR_SIZE / image.naturalHeight)
    const drawWidth = image.naturalWidth * scale
    const drawHeight = image.naturalHeight * scale
    ctx.drawImage(image, (AVATAR_SIZE - drawWidth) / 2, (AVATAR_SIZE - drawHeight) / 2, drawWidth, drawHeight)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** 用户名首字母圆徽字：空用户名显示「?」。 */
function initialOf(username: string): string {
  const first = username.trim().charAt(0)
  return first === '' ? '?' : first.toUpperCase()
}

/** 性别枚举 → 展示文案。 */
function genderLabelOf(gender: string | undefined): string {
  return GENDER_OPTIONS.find((option) => option.value === gender)?.label ?? '未设置'
}

/** 插件内身份段属性（官网身份卡与登录表单卡共用，避免两处重复 JSX）。 */
interface LocalIdentityProps {
  userProfile: MemoryUserProfile | null
  loaded: boolean
  /** 身份卡注入启停开关（辉哥定稿：个人中心直接启停，保存即时生效）。 */
  onToggleEnabled: (next: boolean) => void
  toggleBusy: boolean
  /** 官网搜索工具启停（modagentai_web_search 等模型工具；扣钻石，可一键停）。 */
  searchEnabled: boolean | null
  searchBusy: boolean
  onToggleSearch: (next: boolean) => void
}

/** 插件内身份段：称呼 / 身份简介 / 注入启停开关 + 官网搜索工具开关。 */
function LocalIdentity({ userProfile, loaded, onToggleEnabled, toggleBusy, searchEnabled, searchBusy, onToggleSearch }: LocalIdentityProps): JSX.Element {
  const alias = userProfile?.alias ?? ''
  const identity = userProfile?.identity ?? ''
  const habitCount = userProfile?.habits.length ?? 0
  const enabled = userProfile?.enabled ?? false
  return (
    <div className={css['identitySection']}>
      <span className={css['identitySectionTitle']}>插件身份</span>
      {!loaded && <span className={css['identityHint']}>正在读取插件身份…</span>}
      {loaded && (
        <>
          <div className={css['identityKv']}>
            <span className={css['identityKvLabel']}>称呼</span>
            <strong>{alias !== '' ? alias : '未设置'}</strong>
          </div>
          {identity !== '' && (
            <div className={css['identityKv']}>
              <span className={css['identityKvLabel']}>简介</span>
              <span className={css['identityKvText']}>{identity}</span>
            </div>
          )}
          <label className={css['toggleRow']}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={toggleBusy || userProfile === null}
              onChange={(e) => { onToggleEnabled(e.target.checked) }}
            />
            <span>
              <strong>身份卡注入</strong>
              <small>
                每轮对话自动附带称呼/身份/习惯（习惯 {habitCount} 条） ·{' '}
                <span className={css['identityInject']} data-on={enabled ? 'true' : undefined}>
                  {enabled ? '● 常驻注入中' : '○ 已停用'}
                </span>
              </small>
            </span>
          </label>
          <label className={css['toggleRow']}>
            <input
              type="checkbox"
              checked={searchEnabled === true}
              disabled={searchBusy || searchEnabled === null}
              onChange={(e) => { onToggleSearch(e.target.checked) }}
            />
            <span>
              <strong>官网搜索工具</strong>
              <small>
                模型可用的联网搜索（modagentai_web_search），按次扣钻石约 0.1💎 ·{' '}
                <span className={css['identityInject']} data-on={searchEnabled === true ? 'true' : undefined}>
                  {searchEnabled === null ? '读取中…' : searchEnabled ? '● 已启用' : '○ 已停用'}
                </span>
              </small>
            </span>
          </label>
        </>
      )}
    </div>
  )
}

/** 个人中心页签（一张身份卡：官网账号身份 + 插件内身份 + 我的套餐）。 */
export function ProfileTab({ api, onNavigate }: ProfileTabProps): JSX.Element {
  const [profile, setProfile] = useState<ModagentaiProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 插件内身份（memory.profile 单例，与官网登录态无关）
  const [userProfile, setUserProfile] = useState<MemoryUserProfile | null>(null)
  const [localLoaded, setLocalLoaded] = useState(false)

  // 登录表单（未登录/会话失效态）
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginErr, setLoginErr] = useState('')

  // 资料编辑：默认展示态（元信息一行小字），点「编辑资料」展开一行控件；保存/取消后回到展示态
  const [editing, setEditing] = useState(false)
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [statusErr, setStatusErr] = useState('')

  // 退出登录二次确认：退出会清空本机令牌并停用天工造梦模型路由，先讲清楚再执行（避免误触）。
  const [confirmLogout, setConfirmLogout] = useState(false)

  /** 拉取官网资料；把 gender/birthday 灌进编辑暂存。失败只落提示不崩页面。 */
  const refreshProfile = useCallback(async () => {
    setLoadErr(''); setStatusMsg(''); setStatusErr(''); setLoginErr('')
    try {
      const next = await api.getSiteProfile()
      setProfile(next)
      setGender(typeof next.gender === 'string' ? next.gender : '')
      setBirthday(typeof next.birthday === 'string' ? next.birthday : '')
    } catch (error) {
      setProfile(null)
      setLoadErr(error instanceof Error ? error.message : String(error))
    } finally {
      setLoaded(true)
    }
  }, [api])

  /** 拉取插件内身份（memory.profile；读失败不影响官网身份层）。 */
  const refreshLocal = useCallback(async () => {
    try {
      setUserProfile(await api.getUserProfile())
    } catch {
      setUserProfile(null)
    } finally {
      setLocalLoaded(true)
    }
  }, [api])

  useEffect(() => { void refreshProfile() }, [refreshProfile])
  useEffect(() => { void refreshLocal() }, [refreshLocal])
  useEffect(() => { void api.getModagentaiToolSettings().then((s) => setSearchEnabled(s.webSearchEnabled)).catch(() => setSearchEnabled(null)) }, [api])

  // 身份卡注入开关的保存中状态（两处 LocalIdentity 共用，避免连点）。
  const [toggleBusy, setToggleBusy] = useState(false)

  // 官网搜索工具启停（本地 settings；null=未加载）。
  const [searchEnabled, setSearchEnabled] = useState<boolean | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)

  /** 官网搜索工具启停：乐观更新，失败回滚；保存即时生效无需重启。 */
  async function toggleSearch(next: boolean): Promise<void> {
    if (searchBusy || searchEnabled === null) return
    setSearchBusy(true)
    const previous = searchEnabled
    setSearchEnabled(next)
    try {
      setSearchEnabled((await api.saveModagentaiToolSettings(next)).webSearchEnabled)
      setStatusMsg(next ? '官网搜索工具已启用，模型立即可用。' : '官网搜索工具已停用，模型调用将被拒绝。')
      setStatusErr('')
    } catch (error) {
      setSearchEnabled(previous)
      setStatusErr('搜索工具开关保存失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setSearchBusy(false)
    }
  }

  /** 身份卡注入启停（辉哥定稿）：乐观更新，失败回滚；保存即时生效无需重启。 */
  async function toggleInject(next: boolean): Promise<void> {
    if (userProfile === null || toggleBusy) return
    const previous = userProfile
    setToggleBusy(true)
    setUserProfile({ ...userProfile, enabled: next })
    try {
      setUserProfile(await api.saveUserProfile({ ...userProfile, enabled: next }))
      setStatusMsg(next ? '身份卡注入已启用，即时生效。' : '身份卡注入已停用。')
      setStatusErr('')
    } catch (error) {
      setUserProfile(previous)
      setStatusErr('注入开关保存失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setToggleBusy(false)
    }
  }

  /** 登录官网账号（登录即自动配置中转），成功后拉资料进入资料态。 */
  async function doLogin(): Promise<void> {
    setLoginErr('')
    if (loginUser.trim() === '' || loginPass === '') { setLoginErr('请输入官网用户名和密码'); return }
    setBusy(true)
    try {
      const result = await api.loginModagentai({ username: loginUser.trim(), password: loginPass })
      setLoginPass('')
      if (result.status.role === '') {
        setLoginErr(result.message)
        return
      }
      await refreshProfile()
      if (!result.gatewayApplied) setStatusErr(result.message) // 登录成功但中转自动配置失败：进资料态并保留原因
    } catch (error) {
      setLoginErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 退出官网账号（辉哥 2026-10-08：个人中心缺此入口）。
   * 后端 logout 会尽力吊销官网会话、清空本机令牌、停用天工造梦模型路由与端点密钥，
   * 所以入口先二次确认；成功后重新拉一次真实状态回到未登录态，并说明重新登录即自动恢复。
   */
  async function doLogout(): Promise<void> {
    setStatusErr(''); setStatusMsg('')
    setBusy(true)
    try {
      await api.logoutModagentai()
      setConfirmLogout(false)
      setEditing(false)
      setLoginPass('')
      await refreshProfile()
      setStatusMsg('已退出登录，天工造梦模型路由已停用，重新登录即自动恢复。')
    } catch (error) {
      setStatusErr('退出登录失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setBusy(false)
    }
  }

  /** 保存性别/生日（头像上传即时保存，不走这里）。 */
  async function doSave(): Promise<void> {
    setStatusErr(''); setStatusMsg('')
    setBusy(true)
    try {
      const next = await api.updateSiteProfile({ gender, birthday })
      setProfile(next)
      setEditing(false)
      setStatusMsg('资料已保存')
    } catch (error) {
      setStatusErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** 选择头像 → 压缩成 dataURL → 立即保存（成功后刷新资料）。 */
  async function doUploadAvatar(file: File): Promise<void> {
    setStatusErr(''); setStatusMsg('')
    setBusy(true)
    try {
      const avatar = await fileToAvatarDataUrl(file)
      const next = await api.updateSiteProfile({ avatar })
      setProfile(next)
      setStatusMsg('头像已更新')
    } catch (error) {
      setStatusErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** 进入编辑态：以当前资料初始化编辑控件。 */
  function startEdit(): void {
    setGender(typeof profile?.gender === 'string' ? profile.gender : '')
    setBirthday(typeof profile?.birthday === 'string' ? profile.birthday : '')
    setStatusMsg(''); setStatusErr('')
    setEditing(true)
  }

  const expired = profile !== null && profile.loggedIn && profile.expired === true
  const loggedIn = profile !== null && profile.loggedIn && !expired
  // 展示态元信息：性别 · 生日；两者都没设就提示「资料未完善」
  const metaGender = genderLabelOf(profile?.gender)
  const metaBirthday = typeof profile?.birthday === 'string' && profile.birthday !== '' ? profile.birthday : ''
  const metaText = metaBirthday !== ''
    ? `${metaGender} · ${metaBirthday}`
    : (profile?.gender === undefined || profile.gender === null || profile.gender === '' ? '资料未完善' : metaGender)

  return (
    <div>
      <h2 className={css['sectionTitle']}>个人中心</h2>

      {!loaded && <div className={css['empty']} data-loading="">正在读取官网身份…</div>}

      {loaded && loadErr !== '' && (
        <div className={css['identityCard']} data-state="error">
          <span className={css['identityExpired']}>{loadErr}</span>
          <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void refreshProfile() }}>重试</button>
        </div>
      )}

      {/* 未登录 / 会话失效：登录表单 + 插件身份段（插件身份不依赖官网登录，照常显示） */}
      {loaded && loadErr === '' && !loggedIn && (
        <div className={css['identityCard']}>
          <div className={css['identityHead']}>
            <div className={css['identityAvatar']}><span>{initialOf(expired ? profile?.username ?? '' : loginUser)}</span></div>
            <div className={css['identityMeta']}>
              <div className={css['identityNameRow']}><strong>{expired ? profile?.username ?? '' : '未登录'}</strong></div>
              <span className={css['identityHint']}>登录 modagentai.com 后，头像、性别与生日保存在官网账号里</span>
              {expired && <span className={css['identityExpired']}>会话已失效，请重新登录</span>}
            </div>
          </div>
          <div className={css['identityLogin']}>
            <div className={css['identityLoginRow']}>
              <input
                value={loginUser}
                placeholder="官网用户名"
                onChange={(event) => { setLoginUser(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void doLogin() }}
              />
              <input
                value={loginPass}
                type="password"
                placeholder="官网密码"
                onChange={(event) => { setLoginPass(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void doLogin() }}
              />
              <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void doLogin() }}>{busy ? '登录中…' : '登录'}</button>
            </div>
            <span className={css['identityHint']}>登录后自动配置中转，可用管理员开放的模型</span>
            {loginErr !== '' && <span className={css['identityExpired']}>{loginErr}</span>}
          </div>
          <LocalIdentity userProfile={userProfile} loaded={localLoaded} onToggleEnabled={(next) => { void toggleInject(next) }} toggleBusy={toggleBusy} searchEnabled={searchEnabled} searchBusy={searchBusy} onToggleSearch={(next) => { void toggleSearch(next) }} />
        </div>
      )}

      {/* 已登录资料态：名片式排版——56px 头像 + 用户名徽章 + 元信息一行小字，编辑控件按需展开 */}
      {loaded && loadErr === '' && loggedIn && profile !== null && (
        <div className={css['identityCard']}>
          <div className={css['identityHead']}>
            {/* 头像即上传入口：点击头像直接换图 */}
            <label className={css['identityAvatarBox']} data-busy={busy ? 'true' : undefined} title="点击更换头像">
              <div className={css['identityAvatar']}>
                {profile.avatar !== undefined && profile.avatar !== ''
                  ? <img src={profile.avatar} alt="头像" />
                  : <span>{initialOf(profile.username)}</span>}
              </div>
              <input
                className={css['identityFileInput']}
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file !== undefined && !busy) void doUploadAvatar(file)
                }}
              />
            </label>
            <div className={css['identityMeta']}>
              <div className={css['identityNameRow']}>
                <strong>{profile.username !== '' ? profile.username : '?'}</strong>
                <span className={css['identityBadge']} data-role={profile.role === 'admin' ? 'admin' : 'user'}>{profile.role === 'admin' ? '管理员' : '普通用户'}</span>
              </div>
              {!editing && (
                <div className={css['identityMetaRow']}>
                  <span>{metaText}</span>
                  <span className={css['identityMetaDot']}>·</span>
                  <span>头像、资料存官网账号</span>
                </div>
              )}
              <div className={css['identityActions']}>
                <button type="button" className={css['identityLink']} disabled={busy} onClick={() => { if (!editing) startEdit() }}>
                  {editing ? '编辑中…' : '编辑资料'}
                </button>
                <span className={css['identityMetaDot']}>·</span>
                <button type="button" className={css['identityLink']} disabled={busy} onClick={() => { onNavigate('memory') }}>编辑身份</button>
                <span className={css['identityMetaDot']}>·</span>
                {/* 退出登录：与「编辑资料」并列的次要入口，点击后展开确认行再执行 */}
                <button type="button" className={css['identityLink']} disabled={busy} onClick={() => { setEditing(false); setConfirmLogout(true) }}>退出登录</button>
              </div>
            </div>
          </div>
          {/* 编辑态：一行紧凑控件（性别 + 生日 + 保存/取消），平时完全不占版面 */}
          {editing && (
            <div className={css['identityEditRow']}>
              <select value={gender} onChange={(event) => { setGender(event.target.value) }} aria-label="性别">
                {GENDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input type="date" value={birthday} onChange={(event) => { setBirthday(event.target.value) }} aria-label="生日" />
              <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void doSave() }}>{busy ? '保存中…' : '保存'}</button>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { setEditing(false) }}>取消</button>
            </div>
          )}
          {/* 退出登录二次确认（与「编辑资料」同位置展开）：退出会停用模型路由，先说清后果再执行 */}
          {confirmLogout && (
            <div className={css['identityEditRow']}>
              <span className={css['identityHint']}>退出会清空本机登录令牌，并停用天工造梦模型路由；重新登录即自动恢复。</span>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void doLogout() }}>{busy ? '退出中…' : '确认退出'}</button>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { setConfirmLogout(false) }}>取消</button>
            </div>
          )}
          {(statusMsg !== '' || statusErr !== '') && (
            <div className={css['identityStatus']}>
              {statusMsg !== '' && <span className={css['identitySaved']}>{statusMsg}</span>}
              {statusErr !== '' && <span className={css['identityExpired']}>{statusErr}</span>}
            </div>
          )}
          <LocalIdentity userProfile={userProfile} loaded={localLoaded} onToggleEnabled={(next) => { void toggleInject(next) }} toggleBusy={toggleBusy} searchEnabled={searchEnabled} searchBusy={searchBusy} onToggleSearch={(next) => { void toggleSearch(next) }} />
        </div>
      )}

      {/* 我的套餐（已登录才显示；在用的 + 未激活的都列，已耗尽的不列，不做购买目录） */}
      {loaded && loadErr === '' && loggedIn && <MyPackages />}
    </div>
  )
}
