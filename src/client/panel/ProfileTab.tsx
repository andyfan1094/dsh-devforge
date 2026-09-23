/**
 * 个人中心 —— 只留一张「官网身份卡」大卡片（辉哥 2026-09-23 定稿）。
 * 头像/性别/生日存官网 modagentai.com 关联账号（GET/POST /api/auth/profile，Bearer 令牌鉴权）；
 * 未登录（或会话失效）时卡片内嵌极简登录表单（登录即自动配置中转），
 * 已登录进入资料态：头像上传即存，性别/生日行内编辑、点保存才提交。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ModagentaiProfile } from '../../modagentai/protocol.ts'
import css from './panel.module.css'

/** 个人中心属性：只保留 API 客户端（辉哥 2026-09-23 定稿：页面只有一张身份卡）。 */
export interface ProfileTabProps {
  api: DevforgeApi
}

/** 性别下拉选项：控件值 ↔ 官网枚举（'' = 未设置）。 */
const GENDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '未设置' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'secret', label: '保密' },
]

/** 头像缩放目标边长（官网存 dataURL，128×128 已够身份卡展示）。 */
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

/** 个人中心页签（官网身份卡）。 */
export function ProfileTab({ api }: ProfileTabProps): JSX.Element {
  const [profile, setProfile] = useState<ModagentaiProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 登录表单（未登录/会话失效态）
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginErr, setLoginErr] = useState('')

  // 资料态：性别/生日行内编辑暂存，点保存才提交；提示信息行
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')

  /** 拉取官网资料；把 gender/birthday 灌进编辑暂存。失败只落提示不崩页面。 */
  const refreshProfile = useCallback(async () => {
    setLoadErr(''); setSaveMsg(''); setSaveErr(''); setLoginErr('')
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

  useEffect(() => { void refreshProfile() }, [refreshProfile])

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
      if (!result.gatewayApplied) setSaveErr(result.message) // 登录成功但中转自动配置失败：进资料态并保留原因
    } catch (error) {
      setLoginErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** 保存性别/生日（头像上传即时保存，不走这里）。 */
  async function doSave(): Promise<void> {
    setSaveErr(''); setSaveMsg('')
    setBusy(true)
    try {
      const next = await api.updateSiteProfile({ gender, birthday })
      setProfile(next)
      setSaveMsg('资料已保存')
    } catch (error) {
      setSaveErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** 选择头像 → 压缩成 dataURL → 立即保存（成功后刷新资料）。 */
  async function doUploadAvatar(file: File): Promise<void> {
    setSaveErr(''); setSaveMsg('')
    setBusy(true)
    try {
      const avatar = await fileToAvatarDataUrl(file)
      const next = await api.updateSiteProfile({ avatar })
      setProfile(next)
      setSaveMsg('头像已更新')
    } catch (error) {
      setSaveErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const expired = profile !== null && profile.loggedIn && profile.expired === true
  const loggedIn = profile !== null && profile.loggedIn && !expired

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

      {/* 未登录 / 会话失效：卡片内嵌极简登录表单 */}
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
        </div>
      )}

      {/* 已登录资料态：头像 + 用户名 + 角色徽章 + 行内编辑（性别/生日） */}
      {loaded && loadErr === '' && loggedIn && profile !== null && (
        <div className={css['identityCard']}>
          <div className={css['identityHead']}>
            <div className={css['identityAvatar']}>
              {profile.avatar !== undefined && profile.avatar !== ''
                ? <img src={profile.avatar} alt="头像" />
                : <span>{initialOf(profile.username)}</span>}
            </div>
            <div className={css['identityMeta']}>
              <div className={css['identityNameRow']}>
                <strong>{profile.username !== '' ? profile.username : '?'}</strong>
                <span className={css['identityBadge']} data-role={profile.role === 'admin' ? 'admin' : 'user'}>{profile.role === 'admin' ? '管理员' : '普通用户'}</span>
              </div>
              <span className={css['identityHint']}>头像、性别与生日保存在官网 modagentai.com 账号</span>
            </div>
            <label
              className={css['identityAvatarPick']}
              data-busy={busy ? 'true' : undefined}
              aria-disabled={busy}
            >
              更换头像
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
          </div>
          <div className={css['identityForm']}>
            <label className={css['identityField']}>
              <span>性别</span>
              <select value={gender} onChange={(event) => { setGender(event.target.value) }}>
                {GENDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className={css['identityField']}>
              <span>生日</span>
              <input type="date" value={birthday} onChange={(event) => { setBirthday(event.target.value) }} />
            </label>
            <div className={css['identityFormActions']}>
              <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void doSave() }}>{busy ? '保存中…' : '保存资料'}</button>
            </div>
            {saveMsg !== '' && <span className={css['identitySaved']}>{saveMsg}</span>}
            {saveErr !== '' && <span className={css['identityExpired']}>{saveErr}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
