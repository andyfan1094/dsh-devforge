/**
 * 天工造梦「皮肤」页签 —— 信息密度优先的紧凑版式：皮肤色板网格 +
 * 强调色圆点行 + 壁纸一栏。样式全部走 panel.module.css 与宿主
 * --dsw-alias-* 主题 token，深浅色与换肤自动适配。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { SkinRuntimeApi, SkinState, WallpaperFit } from '../theme/skin-runtime.ts'
import type { DevforgeKey } from '../locales.ts'
import { ACCENT_PRESETS, pickTextOn } from '../theme/accent.ts'
import { WALLPAPER_FITS } from '../theme/skin-runtime.ts'
import { tt } from './helpers.ts'
import css from './panel.module.css'

export interface SkinTabProps {
  /** 皮肤运行时（由 mountPanel 注入）。 */
  skin: SkinRuntimeApi
}

/** 文件大小格式化（KB/MB）。 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

/** 单皮肤卡片预览 swatch（inline style 取自 token）。 */
function SkinSwatch(props: { tokens: Record<string, string> }): JSX.Element {
  const t = props.tokens
  const gradient = 'linear-gradient(120deg, '
    + (t['--dsw-alias-bg-layer-2'] ?? '#fff')
    + ' 0%, '
    + (t['--dsw-alias-bg-layer-1'] ?? '#fff')
    + ' 60%, '
    + (t['--dsw-alias-bg-layer-3'] ?? '#fff')
    + ' 100%)'
  return (
    <div className={css['skinSwatch']}>
      <div className={css['skinSwatchBg']} style={{ background: gradient }} />
      <div
        className={css['skinSwatchDot']}
        style={{
          background: t['--dsw-alias-brand-primary'] ?? '#2563eb',
          color: pickTextOn(t['--dsw-alias-brand-primary'] ?? '#2563eb'),
        }}
      >A</div>
      <div
        className={css['skinSwatchBar']}
        style={{ background: t['--dsw-alias-label-primary'] ?? '#1f2329' }}
      />
      <div
        className={css['skinSwatchBarAlt']}
        style={{ background: t['--dsw-alias-label-secondary'] ?? '#667085' }}
      />
    </div>
  )
}

/** 主组件。 */
export function SkinTab({ skin }: SkinTabProps): JSX.Element {
  const [state, setState] = useState<SkinState>(() => skin.getState())
  const [wallpaperError, setWallpaperError] = useState<string>('')
  const [urlDraft, setUrlDraft] = useState<string>('')
  const [customAccent, setCustomAccent] = useState<string>(() => skin.getState().accent ?? '#2f6fed')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const off = skin.subscribe(setState)
    return off
  }, [skin])

  useEffect(() => {
    if (state.accent !== null) setCustomAccent(state.accent)
  }, [state.accent])

  const accentActive = state.accent !== null

  const handleApplyWallpaperFile = useCallback((file: File): void => {
    if (file.size > 1_800_000) {
      setWallpaperError(tt('skin.errorTooLarge'))
      return
    }
    const reader = new FileReader()
    reader.onerror = (): void => setWallpaperError(tt('skin.errorRead'))
    reader.onload = (): void => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (url.length === 0) {
        setWallpaperError(tt('skin.errorRead'))
        return
      }
      if (!skin.setWallpaper(url)) setWallpaperError(tt('skin.errorSave'))
      else setWallpaperError('')
    }
    reader.readAsDataURL(file)
  }, [skin])

  const handleApplyWallpaperUrl = useCallback((): void => {
    const url = urlDraft.trim()
    if (url.length === 0) return
    if (!skin.setWallpaper(url)) {
      setWallpaperError(tt('skin.urlInvalid'))
      return
    }
    setWallpaperError('')
  }, [skin, urlDraft])

  const handleRemoveWallpaper = useCallback((): void => {
    skin.setWallpaper(null)
    setUrlDraft('')
    setWallpaperError('')
  }, [skin])

  return (
    <section className={css['tabBody']} data-dsh-part="skin-tab">
      {/* 顶部说明 + 恢复默认 */}
      <div className={css['toolbar']}>
        <span className={css['sectionHint']}>{tt('skin.hint')}</span>
        <span className={css['toolbarSpacer']} />
        <button
          type="button"
          className={css['ghostButton']}
          onClick={() => skin.resetAll()}
        >
          {tt('skin.reset')}
        </button>
      </div>

      {wallpaperError !== '' && (
        <div className={css['banner']} data-kind="error" role="alert">{wallpaperError}</div>
      )}

      {state.error !== undefined && state.error !== '' && (
        <div className={css['banner']} data-kind="error" role="alert">
          {state.error}
        </div>
      )}

      {/* 皮肤网格 */}
      <div className={css['sectionTitle']}>{tt('skin.skinsTitle')}</div>
      <div className={css['skinGrid']} role="list">
        {skin.skins.map((s) => {
          const active = state.skinId === s.id
          return (
            <button
              type="button"
              key={s.id}
              role="listitem"
              data-active={active || undefined}
              className={css['skinCard']}
              onClick={() => skin.applySkin(s.id)}
              title={tt(s.labelKey)}
            >
              <SkinSwatch tokens={s.tokens as Record<string, string>} />
              <div className={css['skinCardMeta']}>
                <span className={css['skinCardName']}>{tt(s.labelKey)}</span>
                <span
                  className={css['badge']}
                  data-kind={s.colorScheme === 'dark' ? 'dark' : 'light'}
                >
                  {s.colorScheme === 'dark' ? tt('skin.dark') : tt('skin.light')}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* 强调色 */}
      <div className={css['sectionTitle']}>{tt('skin.accentTitle')}</div>
      <div className={css['accentRow']} role="radiogroup" aria-label={tt('skin.accentTitle')}>
        {ACCENT_PRESETS.map((p) => {
          const active = state.accent !== null && state.accent.toLowerCase() === p.hex.toLowerCase()
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={active}
              className={css['accentDot']}
              data-active={active || undefined}
              style={{ background: p.hex, color: pickTextOn(p.hex) }}
              title={tt(p.labelKey)}
              onClick={() => skin.setAccent(p.hex)}
            >A</button>
          )
        })}
        <label className={css['accentCustom']} data-active={accentActive && !ACCENT_PRESETS.some((p) => p.hex.toLowerCase() === state.accent?.toLowerCase()) || undefined}>
          <span>{tt('skin.accentCustom')}</span>
          <input
            type="color"
            value={customAccent}
            onChange={(e) => setCustomAccent(e.target.value)}
            onBlur={(e) => { skin.setAccent(e.target.value) }}
          />
        </label>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={!accentActive}
          onClick={() => skin.setAccent(null)}
        >{tt('skin.accentClear')}</button>
      </div>

      {/* 壁纸 */}
      <div className={css['sectionTitle']}>{tt('skin.wallpaperTitle')}</div>
      <div className={css['wallpaperCard']}>
        <div className={css['wallpaperRow']}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f !== undefined) handleApplyWallpaperFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={css['primaryButton']}
            onClick={() => fileInputRef.current?.click()}
          >{tt('skin.chooseImage')}</button>
          <input
            type="text"
            className={css['input']}
            placeholder={tt('skin.urlPlaceholder')}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyWallpaperUrl() }}
          />
          <button
            type="button"
            className={css['ghostButton']}
            disabled={urlDraft.trim().length === 0}
            onClick={handleApplyWallpaperUrl}
          >{tt('skin.urlApply')}</button>
          <button
            type="button"
            className={css['ghostButton']}
            disabled={state.wallpaper === null}
            onClick={handleRemoveWallpaper}
          >{tt('skin.wallpaperRemove')}</button>
          <span className={css['sectionHint']}>
            {state.wallpaper === null
              ? tt('skin.wallpaperOff')
              : fmtSize(state.wallpaper.length)}
          </span>
        </div>
        <div className={css['sliderRow']}>
          <label className={css['sliderLabel']}>
            <span>{tt('skin.opacity')}</span>
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.02}
              value={state.opacity}
              onChange={(e) => skin.setWallpaperOpacity(Number(e.target.value))}
              disabled={state.wallpaper === null}
            />
            <span className={css['sliderValue']}>{Math.round(state.opacity * 100)}%</span>
          </label>
          <label className={css['sliderLabel']}>
            <span>{tt('skin.blur')}</span>
            <input
              type="range"
              min={0}
              max={24}
              step={1}
              value={state.blur}
              onChange={(e) => skin.setWallpaperBlur(Number(e.target.value))}
              disabled={state.wallpaper === null}
            />
            <span className={css['sliderValue']}>{state.blur}px</span>
          </label>
          <label className={css['sliderLabel']}>
            <span>{tt('skin.fit')}</span>
            <select
              className={css['input']}
              value={state.fit}
              onChange={(e) => skin.setWallpaperFit(e.target.value as WallpaperFit)}
              disabled={state.wallpaper === null}
            >
              {WALLPAPER_FITS.map((f) => (
                <option key={f} value={f}>{tt(('skin.fit.' + f) as DevforgeKey)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}
