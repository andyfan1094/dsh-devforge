/**
 * 用户身份卡单测：规整（夹紧/去重/截断）与常驻注入文本渲染。
 * 纯函数测试，不触库、不触宿主。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_USER_PROFILE, normalizeUserProfile, renderUserProfileText } from '../src/memory/profile.ts'

test('身份卡规整：habits 去空去重截断，maxChars 夹紧', () => {
  const normalized = normalizeUserProfile({
    enabled: true,
    alias: '  辉哥  ',
    identity: '开发者',
    habits: ['文档中文', '', '文档中文', '   ', '界面紧凑', 42, { x: 1 }],
    maxChars: 99_999,
  }, DEFAULT_USER_PROFILE)
  assert.equal(normalized.alias, '辉哥')
  assert.deepEqual(normalized.habits, ['文档中文', '界面紧凑'])
  assert.equal(normalized.maxChars, 2000)
})

test('身份卡规整：非法输入回落当前值', () => {
  const current = { ...DEFAULT_USER_PROFILE, alias: '保持' }
  assert.equal(normalizeUserProfile(null, current).alias, '保持')
  assert.equal(normalizeUserProfile('oops', current).alias, '保持')
  assert.equal(normalizeUserProfile(undefined, current).maxChars, DEFAULT_USER_PROFILE.maxChars)
})

test('身份卡渲染：关闭或全空返回空串（不注入空块）', () => {
  assert.equal(renderUserProfileText({ ...DEFAULT_USER_PROFILE, enabled: false }), '')
  assert.equal(renderUserProfileText(DEFAULT_USER_PROFILE), '')
})

test('身份卡渲染：完整卡包含称呼/身份/习惯编号，超长截断', () => {
  const text = renderUserProfileText({
    enabled: true,
    alias: '辉哥',
    identity: '天工造梦作者',
    habits: ['文档一律中文', '界面紧凑优先'],
    maxChars: 800,
  })
  assert.ok(text.includes('【用户身份卡'))
  assert.ok(text.includes('称呼：辉哥'))
  assert.ok(text.includes('身份：天工造梦作者'))
  assert.ok(text.includes('1. 文档一律中文'))
  assert.ok(text.includes('2. 界面紧凑优先'))
  const long = renderUserProfileText({
    enabled: true,
    alias: '辉哥',
    identity: '长'.repeat(1200),
    habits: [],
    maxChars: 300,
  })
  assert.ok(long.length <= 300, '渲染文本必须截断到 maxChars')
})
