/**
 * 个人中心 —— 天工造梦面板首页（辉哥 2026-09-21 定稿：替换教程页）。
 * 聚合只读状态：身份卡（称呼/简介/习惯）、插件与 DSH 本体版本、各模型服务接入状态、
 * 官网账号登录（登录即自动配置中转，辉哥 2026-09-22 加）；
 * 全部并发拉取、逐项容错，任何一路失败不影响其余展示。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ModagentaiStatus } from '../../modagentai/protocol.ts'
import css from './panel.module.css'

/** 单条服务接入状态行。 */
interface ServiceRow {
  key: string
  label: string
  detail: string
  ok: boolean
}

/** 个人中心属性：onNavigate 跳转到对应页签（编辑身份/查用量/飞书配置）。 */
export interface ProfileTabProps {
  api: DevforgeApi
  onNavigate: (tab: 'codeplan' | 'memory' | 'feishu' | 'pluginupdate') => void
}

/** 个人中心页签。 */
export function ProfileTab({ api, onNavigate }: ProfileTabProps): JSX.Element {
  const [alias, setAlias] = useState('')
  const [identity, setIdentity] = useState('')
  const [habitCount, setHabitCount] = useState(0)
  const [profileEnabled, setProfileEnabled] = useState(false)
  const [pluginVersion, setPluginVersion] = useState('')
  const [harnessVersion, setHarnessVersion] = useState('')
  const [services, setServices] = useState<ServiceRow[]>([])
  const [loaded, setLoaded] = useState(false)

  // —— 官网账号（登录即自动配置中转）——
  const [site, setSite] = useState<ModagentaiStatus | null>(null)
  const [siteLoaded, setSiteLoaded] = useState(false)
  const [siteUser, setSiteUser] = useState('')
  const [sitePass, setSitePass] = useState('')
  const [siteBusy, setSiteBusy] = useState(false)
  const [siteErr, setSiteErr] = useState('')
  const [siteMsg, setSiteMsg] = useState('')

  const refreshSite = useCallback(async () => {
    try {
      setSite(await api.getModagentaiStatus())
    } catch {
      setSite(null)
    } finally {
      setSiteLoaded(true)
    }
  }, [api])

  useEffect(() => { void refreshSite() }, [refreshSite])

  /** 服务接入列表重拉：登录/配置中转成功后刷新「天工造梦中转」等行。 */
  const refreshServices = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getZhipuStatus(),
      api.getArkStatus(),
      api.getMiniMaxStatus(),
      api.getSiliconFlowStatus(),
      api.getOpenAiGatewayStatus(),
      api.getFeishuStatus(),
    ])
    const [zhipu, ark, minimax, siliconflow, gateway, feishu] = results
    const rows: ServiceRow[] = []
    rows.push({
      key: 'zhipu',
      label: '智谱 GLM',
      ok: zhipu.status === 'fulfilled' && zhipu.value.credentialConfigured,
      detail: zhipu.status === 'fulfilled'
        ? (zhipu.value.credentialConfigured
          ? `已配置 · Key 池 ${zhipu.value.keys.length} 把${zhipu.value.mcpTools ? ' · 官方工具已启用' : ''}`
          : '未配置 API Key')
        : '状态读取失败',
    })
    rows.push({
      key: 'ark',
      label: '火山方舟',
      ok: ark.status === 'fulfilled' && ark.value.credentialConfigured,
      detail: ark.status === 'fulfilled'
        ? (ark.value.credentialConfigured
          ? `数据面已配置 · 控制面 ${ark.value.usageAccessKeyConfigured && ark.value.usageSecretKeyConfigured ? 'AK/SK 已配置' : '待配置 AK/SK'}`
          : '未配置 API Key')
        : '状态读取失败',
    })
    rows.push({
      key: 'minimax',
      label: 'MiniMax',
      ok: minimax.status === 'fulfilled' && minimax.value.credentialConfigured,
      detail: minimax.status === 'fulfilled'
        ? (minimax.value.credentialConfigured ? `已配置${minimax.value.tools ? ' · 官方工具已启用' : ''}` : '未配置 API Key')
        : '状态读取失败',
    })
    rows.push({
      key: 'siliconflow',
      label: '硅基流动',
      ok: siliconflow.status === 'fulfilled' && siliconflow.value.credentialConfigured,
      detail: siliconflow.status === 'fulfilled'
        ? (siliconflow.value.credentialConfigured ? `已配置 · ${siliconflow.value.syncChatModels ? '同步对话模型目录' : '仅向量嵌入模式'}` : '未配置 API Key')
        : '状态读取失败',
    })
    rows.push({
      key: 'gateway',
      label: '天工造梦中转',
      ok: gateway.status === 'fulfilled' && gateway.value.credentialConfigured,
      detail: gateway.status === 'fulfilled'
        ? (gateway.value.credentialConfigured
          ? `已配置 · 端点 ${gateway.value.endpoints.length} 个 · 模型 ${gateway.value.models.length} 个`
          : '未配置 API Key')
        : '状态读取失败',
    })
    rows.push({
      key: 'feishu',
      label: '飞书',
      ok: feishu.status === 'fulfilled' && feishu.value.connected,
      detail: feishu.status === 'fulfilled' ? (feishu.value.connected ? '已连接' : '未连接') : '状态读取失败',
    })
    setServices(rows)
    setLoaded(true)
  }, [api])

  async function doSiteLogin(): Promise<void> {
    setSiteErr(''); setSiteMsg('')
    if (siteUser.trim() === '' || sitePass === '') { setSiteErr('请输入官网用户名和密码'); return }
    setSiteBusy(true)
    try {
      const result = await api.loginModagentai({ username: siteUser.trim(), password: sitePass })
      setSite(result.status)
      setSitePass('')
      if (result.gatewayApplied) {
        setSiteMsg('登录成功，' + result.message + '，模型 ' + result.gatewayModels + ' 个已进入聊天路由')
        void refreshServices()
        if (result.status.role === 'admin') onNavigate('codeplan') // 管理员顺手跳 Coding Plan 看用量
      } else {
        setSiteErr(result.message)
      }
    } catch (error) {
      setSiteErr(error instanceof Error ? error.message : String(error))
    } finally {
      setSiteBusy(false)
    }
  }

  async function doSiteLogout(): Promise<void> {
    setSiteErr(''); setSiteMsg('')
    setSiteBusy(true)
    try {
      setSite(await api.logoutModagentai())
      setSiteMsg('已退出官网账号（中转端点保留，令牌已失效）')
    } catch (error) {
      setSiteErr(error instanceof Error ? error.message : String(error))
    } finally {
      setSiteBusy(false)
    }
  }

  async function doApplyGateway(): Promise<void> {
    setSiteErr(''); setSiteMsg('')
    setSiteBusy(true)
    try {
      setSite(await api.applyModagentaiGateway())
      setSiteMsg('中转已重新配置完成')
      void refreshServices()
    } catch (error) {
      setSiteErr(error instanceof Error ? error.message : String(error))
    } finally {
      setSiteBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const results = await Promise.allSettled([
        api.getUserProfile(),
        api.getDevforgeMeta(),
        api.checkHarnessUpdate(),
        api.getZhipuStatus(),
        api.getArkStatus(),
        api.getMiniMaxStatus(),
        api.getSiliconFlowStatus(),
        api.getOpenAiGatewayStatus(),
        api.getFeishuStatus(),
      ])
      if (cancelled) return
      const [profile, meta, harness, zhipu, ark, minimax, siliconflow, gateway, feishu] = results
      if (profile.status === 'fulfilled') {
        setAlias(profile.value.alias)
        setIdentity(profile.value.identity)
        setHabitCount(profile.value.habits.length)
        setProfileEnabled(profile.value.enabled)
      }
      if (meta.status === 'fulfilled') setPluginVersion(meta.value.version)
      if (harness.status === 'fulfilled') setHarnessVersion(harness.value.installed)
      const rows: ServiceRow[] = []
      rows.push({
        key: 'zhipu',
        label: '智谱 GLM',
        ok: zhipu.status === 'fulfilled' && zhipu.value.credentialConfigured,
        detail: zhipu.status === 'fulfilled'
          ? (zhipu.value.credentialConfigured
            ? `已配置 · Key 池 ${zhipu.value.keys.length} 把${zhipu.value.mcpTools ? ' · 官方工具已启用' : ''}`
            : '未配置 API Key')
          : '状态读取失败',
      })
      rows.push({
        key: 'ark',
        label: '火山方舟',
        ok: ark.status === 'fulfilled' && ark.value.credentialConfigured,
        detail: ark.status === 'fulfilled'
          ? (ark.value.credentialConfigured
            ? `数据面已配置 · 控制面 ${ark.value.usageAccessKeyConfigured && ark.value.usageSecretKeyConfigured ? 'AK/SK 已配置' : '待配置 AK/SK'}`
            : '未配置 API Key')
          : '状态读取失败',
      })
      rows.push({
        key: 'minimax',
        label: 'MiniMax',
        ok: minimax.status === 'fulfilled' && minimax.value.credentialConfigured,
        detail: minimax.status === 'fulfilled'
          ? (minimax.value.credentialConfigured ? `已配置${minimax.value.tools ? ' · 官方工具已启用' : ''}` : '未配置 API Key')
          : '状态读取失败',
      })
      rows.push({
        key: 'siliconflow',
        label: '硅基流动',
        ok: siliconflow.status === 'fulfilled' && siliconflow.value.credentialConfigured,
        detail: siliconflow.status === 'fulfilled'
          ? (siliconflow.value.credentialConfigured ? `已配置 · ${siliconflow.value.syncChatModels ? '同步对话模型目录' : '仅向量嵌入模式'}` : '未配置 API Key')
          : '状态读取失败',
      })
      rows.push({
        key: 'gateway',
        label: '天工造梦中转',
        ok: gateway.status === 'fulfilled' && gateway.value.credentialConfigured,
        detail: gateway.status === 'fulfilled'
          ? (gateway.value.credentialConfigured
            ? `已配置 · 端点 ${gateway.value.endpoints.length} 个 · 模型 ${gateway.value.models.length} 个`
            : '未配置 API Key')
          : '状态读取失败',
      })
      rows.push({
        key: 'feishu',
        label: '飞书',
        ok: feishu.status === 'fulfilled' && feishu.value.connected,
        detail: feishu.status === 'fulfilled' ? (feishu.value.connected ? '已连接' : '未连接') : '状态读取失败',
      })
      setServices(rows)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [api])

  return (
    <div>
      <h2 className={css['sectionTitle']}>个人中心</h2>

      {/* 身份卡：记忆工作台的常驻身份卡摘要；编辑去记忆工作台。 */}
      <div className={css['metricList']}>
        <div className={css['metricRow']}>
          <span>
            <strong>{alias !== '' ? alias : '未设置称呼'}</strong>
            <span className={css['sectionHint']}> {profileEnabled ? '身份卡常驻注入中' : '身份卡注入已关闭'}</span>
          </span>
          <button type="button" className={css['ghostButton']} onClick={() => { onNavigate('memory') }}>编辑身份</button>
        </div>
        {identity !== '' && <div className={css['metricRow']}><span className={css['sectionHint']}>{identity}</span></div>}
        <div className={css['metricRow']}>
          <span className={css['sectionHint']}>习惯与硬偏好 {habitCount} 条 · 每轮固定注入，让每个模型都按你的习惯干活</span>
        </div>
      </div>

      <h3 className={css['sectionTitle']}>官网账号（modagentai.com）</h3>
      <div className={css['metricList']}>
        {!siteLoaded && <div className={css['empty']}>正在读取官网账号状态…</div>}
        {siteLoaded && site !== null && site.loggedIn && (
          <div className={css['metricRow']}>
            <span>
              <strong>👤 {site.username}</strong>
              <span className={css['sectionHint']}> {site.role === 'admin' ? '管理员' : '普通用户'} · 中转{site.autoApplied ? `已自动配置（模型 ${site.appliedModels} 个）` : '未配置'}</span>
              {site.expired && <span className={css['sectionHint']} style={{ color: 'var(--dsw-alias-state-danger-primary, #dc2626)' }}> · 会话已失效，请重新登录</span>}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              {site.role === 'admin' && <button type="button" className={css['ghostButton']} onClick={() => { onNavigate('codeplan') }}>Coding Plan</button>}
              <button type="button" className={css['ghostButton']} disabled={siteBusy} onClick={() => { void doApplyGateway() }}>重新配置中转</button>
              <button type="button" className={css['ghostButton']} disabled={siteBusy} onClick={() => { void doSiteLogout() }}>退出登录</button>
            </span>
          </div>
        )}
        {siteLoaded && (site === null || !site.loggedIn) && (
          <div className={css['metricRow']}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={siteUser}
                placeholder="官网用户名"
                onChange={(event) => { setSiteUser(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !siteBusy) void doSiteLogin() }}
                style={{ width: 160 }}
              />
              <input
                value={sitePass}
                type="password"
                placeholder="官网密码"
                onChange={(event) => { setSitePass(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !siteBusy) void doSiteLogin() }}
                style={{ width: 160 }}
              />
              <button type="button" className={css['ghostButton']} disabled={siteBusy} onClick={() => { void doSiteLogin() }}>{siteBusy ? '登录中…' : '登录'}</button>
              <span className={css['sectionHint']}>登录后自动配置中转，可用管理员开放的模型</span>
            </span>
          </div>
        )}
        {siteErr !== '' && <div className={css['metricRow']}><span className={css['sectionHint']} style={{ color: 'var(--dsw-alias-state-danger-primary, #dc2626)' }}>{siteErr}</span></div>}
        {siteMsg !== '' && <div className={css['metricRow']}><span className={css['sectionHint']} style={{ color: 'var(--dsw-alias-state-success-primary, #16a34a)' }}>{siteMsg}</span></div>}
      </div>

      <h3 className={css['sectionTitle']}>版本</h3>
      <div className={css['metricList']}>
        <div className={css['metricRow']}>
          <span><strong>天工造梦（dsh-devforge）</strong></span>
          <span className={css['sectionHint']}>{pluginVersion !== '' ? 'v' + pluginVersion : '读取中…'}</span>
        </div>
        <div className={css['metricRow']}>
          <span><strong>DSH 本体</strong></span>
          <span className={css['sectionHint']}>{harnessVersion !== '' ? 'v' + harnessVersion : '读取中…'}</span>
        </div>
        <div className={css['metricRow']}>
          <button type="button" className={css['ghostButton']} onClick={() => { onNavigate('pluginupdate') }}>检查更新</button>
        </div>
      </div>

      <h3 className={css['sectionTitle']}>服务接入</h3>
      {!loaded && <div className={css['empty']}>正在读取各服务接入状态…</div>}
      {loaded && (
        <div className={css['metricList']}>
          {services.map((row) => (
            <div key={row.key} className={css['metricRow']}>
              <span>
                <strong>{row.label}</strong>
                <span className={css['sectionHint']}> {row.detail}</span>
              </span>
              <span className={css['sectionHint']} style={{ color: row.ok ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-label-tertiary)' }}>
                {row.ok ? '● 已接入' : '○ 未接入'}
              </span>
            </div>
          ))}
        </div>
      )}

      <h3 className={css['sectionTitle']}>快捷入口</h3>
      <div className={css['metricList']}>
        <div className={css['metricRow']}>
          {(site?.role === 'admin') && <button type="button" className={css['ghostButton']} onClick={() => { onNavigate('codeplan') }}>Coding Plan · 用量与接入</button>}
          <button type="button" className={css['ghostButton']} onClick={() => { onNavigate('feishu') }}>飞书配置</button>
        </div>
      </div>
    </div>
  )
}
