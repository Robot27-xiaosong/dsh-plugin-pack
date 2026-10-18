/**
 * Settings panel for dsh-plugin-pack, styled to match DSH's native UI.
 * Three tabs: Scan/Export, Packs, Import.
 *
 * No native prompt()/confirm() — DSH's embedded browser may not support them.
 * All interactions use inline UI state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { packApi, type CommunityPlugin, type PackRecord, type PackPlugin } from './api.js'

type Tab = 'scan' | 'packs' | 'import'

// ---- Design tokens (DSH-native neutral palette) --------------------------

const C = {
  bg: '#ffffff',
  surface: '#f6f8fa',
  border: '#d0d7de',
  borderLight: '#eaeef2',
  text: '#1f2328',
  textSecondary: '#656d76',
  textMuted: '#8b949e',
  accent: '#1f2328',
  accentHover: '#000000',
  accentLight: '#f0f1f3',
  danger: '#cf222e',
  dangerLight: '#ffebe9',
  success: '#1a7f37',
  successLight: '#dafbe1',
  warning: '#9a6700',
  warningLight: '#fff8c5',
  radius: '12px',
  radiusSm: '8px',
}

const s = {
  wrap: { padding: '20px 24px 32px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", Roboto, sans-serif', color: C.text, background: C.bg, minHeight: '100%' } as const,
  tabs: { display: 'flex', gap: '0', borderBottom: `1px solid ${C.borderLight}`, marginBottom: '20px' } as const,
  tab: (active: boolean) => ({
    padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
    fontSize: '14px', fontWeight: active ? 600 : 400,
    color: active ? C.text : C.textSecondary,
    borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
    marginBottom: '-1px', transition: 'color .15s',
  }) as const,
  toolbar: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' as const } as const,
  btn: (primary = false, danger = false) => ({
    padding: '6px 14px', fontSize: '13px', fontWeight: 500, borderRadius: C.radiusSm, cursor: 'pointer',
    border: danger ? `1px solid ${C.danger}` : primary ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
    background: danger ? C.bg : primary ? C.accent : C.bg,
    color: danger ? C.danger : primary ? '#fff' : C.text,
    transition: 'background .15s, border-color .15s',
  }) as const,
  btnSm: { padding: '4px 10px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${C.border}`, background: C.bg, color: C.textSecondary } as const,
  btnSmDanger: { padding: '4px 10px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer', border: '1px solid #ffcecb', background: C.bg, color: C.danger } as const,
  input: { padding: '7px 12px', fontSize: '13px', borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', width: '220px' } as const,
  inputSm: { padding: '5px 10px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', width: '160px' } as const,
  textarea: { width: '100%', minHeight: '140px', padding: '12px', fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", monospace', borderRadius: C.radius, border: `1px solid ${C.border}`, background: C.bg, color: C.text, resize: 'vertical' as const, outline: 'none', lineHeight: 1.5 } as const,
  error: { color: C.danger, fontSize: '13px', padding: '10px 14px', background: C.dangerLight, borderRadius: C.radiusSm, marginBottom: '12px' } as const,
  success: { color: C.success, fontSize: '13px', padding: '10px 14px', background: C.successLight, borderRadius: C.radiusSm, marginBottom: '12px' } as const,
  hint: { color: C.textMuted, fontSize: '12px', marginTop: '8px' } as const,
  sectionTitle: { fontSize: '15px', fontWeight: 600, margin: '0 0 14px 0' } as const,
  // Form styles
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: '12px' } as const,
  formField: { display: 'flex', flexDirection: 'column' as const, gap: '4px' } as const,
  formLabel: { fontSize: '12px', fontWeight: 500, color: C.textSecondary } as const,
  formInput: { padding: '7px 12px', fontSize: '13px', borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box' as const } as const,
  formTextarea: { padding: '8px 12px', fontSize: '13px', borderRadius: C.radiusSm, border: `1px solid ${C.border}`, background: C.bg, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box' as const, minHeight: '60px', resize: 'vertical' as const, fontFamily: 'inherit', lineHeight: 1.5 } as const,
  empty: { color: C.textMuted, fontSize: '13px', padding: '32px', textAlign: 'center' as const, background: C.surface, borderRadius: C.radius, border: `1px solid ${C.borderLight}` } as const,

  // Plugin card (DSH-native style)
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px', marginBottom: '20px' } as const,
  card: { background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: C.radius, padding: '16px', transition: 'border-color .15s, box-shadow .15s', cursor: 'pointer', outline: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent' } as const,
  cardSelected: { borderColor: C.accent, boxShadow: `0 0 0 1px ${C.accent}` } as const,
  cardDeselected: { borderColor: C.borderLight, boxShadow: 'none' } as const,
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' } as const,
  cardName: { fontWeight: 600, fontSize: '15px', color: C.text, wordBreak: 'break-all' } as const,
  cardVersion: { fontSize: '12px', color: C.textMuted, fontFamily: 'ui-monospace, monospace', marginTop: '2px' } as const,
  cardDesc: { fontSize: '13px', color: C.textSecondary, lineHeight: 1.5, margin: '8px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '39px' } as const,
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${C.borderLight}` } as const,
  badge: (color: string, bg: string) => ({ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '10px', background: bg, color }) as const,
  toggle: (on: boolean) => ({
    position: 'relative' as const, width: '36px', height: '20px', borderRadius: '10px',
    background: on ? C.accent : '#d1d5db', cursor: 'pointer', border: 'none', transition: 'background .15s', flexShrink: 0,
  }) as const,
  toggleKnob: (on: boolean) => ({
    position: 'absolute' as const, top: '2px', left: on ? '18px' : '2px', width: '16px', height: '16px',
    borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
  }) as const,

  // Pack record card
  packCard: { background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: C.radius, padding: '16px', marginBottom: '10px' } as const,
  packHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' as const } as const,
  packName: { fontWeight: 600, fontSize: '15px' } as const,
  packMeta: { fontSize: '12px', color: C.textMuted } as const,
  packActions: { display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' as const } as const,
  pre: { background: C.surface, padding: '12px', borderRadius: C.radiusSm, fontSize: '11px', fontFamily: 'ui-monospace, monospace', overflow: 'auto', maxHeight: '280px', margin: '10px 0 0', lineHeight: 1.5 } as const,
  listItem: { padding: '8px 0', fontSize: '13px', borderBottom: `1px solid ${C.borderLight}` } as const,
  inlineRow: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px' } as const,
}

// ---- Toggle switch -------------------------------------------------------

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button style={s.toggle(on)} onClick={(e) => { e.stopPropagation(); onChange() }} aria-pressed={on}>
      <span style={s.toggleKnob(on)} />
    </button>
  )
}

// ---- Main component ------------------------------------------------------

export function PackSection() {
  const [tab, setTab] = useState<Tab>('scan')
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<{ latest: string; current: string; hasUpdate: boolean; url: string; body?: string } | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [updateDone, setUpdateDone] = useState<string | null>(null)

  const checkUpdate = async () => {
    setUpdateChecking(true); setUpdateError(''); setUpdateResult(null); setUpdateDone(null)
    try {
      const result = await packApi.checkUpdate()
      setUpdateResult(result)
    } catch (e) { setUpdateError((e as Error).message) }
    finally { setUpdateChecking(false) }
  }

  const doUpdate = async () => {
    setUpdating(true); setUpdateError('')
    try {
      const result = await packApi.updatePlugin()
      if (result.alreadyLatest) {
        setUpdateDone(`已是最新版 v${result.version || ''}`)
      } else {
        setUpdateDone(`已更新到 v${result.version}，请重启 DSH 生效`)
      }
      setUpdateResult(null)
    } catch (e) { setUpdateError((e as Error).message) }
    finally { setUpdating(false) }
  }

  return (
    <div style={s.wrap}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ ...s.tabs, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          <button style={s.tab(tab === 'scan')} onClick={() => setTab('scan')}>扫描 / 导出</button>
          <button style={s.tab(tab === 'packs')} onClick={() => setTab('packs')}>插件包</button>
          <button style={s.tab(tab === 'import')} onClick={() => setTab('import')}>导入</button>
        </div>
        <button
          style={{ ...s.btnSm, marginRight: '4px', alignSelf: 'center' }}
          onClick={() => void checkUpdate()}
          disabled={updateChecking || updating}
        >
          {updateChecking ? '检查中…' : updating ? '更新中…' : updateResult?.hasUpdate ? `有更新 v${updateResult.latest}` : '检查更新'}
        </button>
      </div>
      {updateError && <div style={{ ...s.error, marginTop: '-8px' }}>{updateError}</div>}
      {updateDone && <div style={{ ...s.success, marginTop: '-8px' }}>{updateDone}</div>}
      {updateResult && !updateResult.hasUpdate && !updateDone && (
        <div style={{ ...s.success, marginTop: '-8px' }}>已是最新版本 v{updateResult.current}</div>
      )}
      {updateResult && updateResult.hasUpdate && (
        <div style={{ ...s.success, marginTop: '-8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span>发现新版本 <strong>v{updateResult.latest}</strong>（当前 v{updateResult.current}）</span>
          <button style={{ ...s.btnSm, background: C.accent, color: '#fff', borderColor: C.accent }} onClick={() => void doUpdate()} disabled={updating}>
            {updating ? '更新中…' : '立即更新'}
          </button>
          <a href={updateResult.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: C.textSecondary }}>查看 Release</a>
        </div>
      )}
      {tab === 'scan' && <ScanExportTab />}
      {tab === 'packs' && <PacksTab />}
      {tab === 'import' && <ImportTab />}
    </div>
  )
}

// ---- Scan / Export tab ---------------------------------------------------

function ScanExportTab() {
  const [plugins, setPlugins] = useState<CommunityPlugin[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [packName, setPackName] = useState('')
  const [packDesc, setPackDesc] = useState('')
  const [packNotes, setPackNotes] = useState('')
  const [packVersion, setPackVersion] = useState('')
  const [packAuthor, setPackAuthor] = useState('')
  const [packTags, setPackTags] = useState('')
  const [packPromoUrl, setPackPromoUrl] = useState('')
  const [packCompatible, setPackCompatible] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportedName, setExportedName] = useState('')
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(''); setExportedName('')
    try {
      const { plugins } = await packApi.scan()
      setPlugins(plugins)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = (name: string) => setSelected((prev) => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const doExport = async () => {
    if (!packName.trim()) { setError('请输入插件包名称'); return }
    if (selected.size === 0) { setError('请至少勾选一个插件'); return }
    setLoading(true); setError(''); setExportedName('')
    try {
      const meta: Parameters<typeof packApi.exportBundle>[1] = { name: packName.trim() }
      if (packDesc.trim()) meta.description = packDesc.trim()
      if (packNotes.trim()) meta.notes = packNotes.trim()
      if (packVersion.trim()) meta.version = packVersion.trim()
      if (packAuthor.trim()) meta.author = packAuthor.trim()
      if (packTags.trim()) meta.tags = packTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      if (packPromoUrl.trim()) meta.promoUrl = packPromoUrl.trim()
      if (packCompatible.trim()) meta.dsh = { compatible: packCompatible.trim() }
      const { blob, filename } = await packApi.exportBundle(
        { select: Array.from(selected) },
        meta,
      )
      // Trigger browser download directly.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportedName(filename)
      setPackName(''); setPackDesc(''); setPackNotes(''); setPackVersion(''); setPackAuthor('')
      setPackTags(''); setPackPromoUrl(''); setPackCompatible('')
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div style={s.toolbar}>
        <button style={s.btn()} onClick={refresh} disabled={loading}>{loading ? '扫描中…' : '重新扫描'}</button>
        <button style={s.btn()} onClick={() => setSelected(new Set(plugins.map((p) => p.name)))}>全选</button>
        <button style={s.btn()} onClick={() => setSelected(new Set())}>清空</button>
        <span style={{ fontSize: '13px', color: C.textSecondary }}>已选 {selected.size} / {plugins.length}</span>
      </div>
      {error && <div style={s.error}>{error}</div>}

      {plugins.length > 0 ? (
        <div style={s.cardGrid}>
          {plugins.map((p) => {
            const isSel = selected.has(p.name)
            return (
              <div
                key={p.name}
                style={{ ...s.card, ...(isSel ? s.cardSelected : s.cardDeselected) }}
                onClick={() => toggle(p.name)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div style={s.cardHeader}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ ...s.cardName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={s.cardVersion}>{p.version ? 'v' + p.version : '本地开发'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button
                      style={{ ...s.btnSm, border: 'none', background: 'none', padding: '2px 6px', fontSize: '11px' }}
                      onClick={(e) => { e.stopPropagation(); setExpandedCard(expandedCard === p.name ? null : p.name) }}
                    >
                      {expandedCard === p.name ? '收起' : '展开'}
                    </button>
                    <Toggle on={isSel} onChange={() => toggle(p.name)} />
                  </div>
                </div>
                <div style={expandedCard === p.name ? { ...s.cardDesc, display: 'block', WebkitLineClamp: 'unset', overflow: 'visible', minHeight: 'auto' } : s.cardDesc}>
                  {p.description || '暂无描述'}
                </div>
                {expandedCard === p.name && (
                  <div style={{ fontSize: '11px', color: C.textMuted, fontFamily: 'ui-monospace, monospace', marginBottom: '8px', wordBreak: 'break-all', lineHeight: 1.5 }}>
                    来源：{p.rawSpec}
                  </div>
                )}
                <div style={s.cardFooter}>
                  <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {p.enabled
                      ? <span style={s.badge(C.success, C.successLight)}>启用中</span>
                      : <span style={s.badge(C.textMuted, C.accentLight)}>已停用</span>}
                    {p.portable
                      ? <span style={s.badge(C.textSecondary, C.accentLight)}>可移植</span>
                      : <span style={s.badge(C.warning, C.warningLight)}>不可移植</span>}
                  </span>
                  {expandedCard !== p.name && (
                    <span style={{ fontSize: '11px', color: C.textMuted, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '50%' }}>{p.rawSpec}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        !loading && <div style={s.empty}>未发现社区插件</div>
      )}

      {/* Export section */}
      <div style={{ ...s.packCard, background: C.surface }}>
        <h3 style={s.sectionTitle}>导出插件包</h3>
        <div style={s.formGrid}>
          <div style={s.formField}>
            <label style={s.formLabel}>插件包名称 <span style={{ color: C.danger }}>*</span></label>
            <input style={s.formInput} placeholder="我的插件包" value={packName} onChange={(e) => setPackName(e.target.value)} />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>版本</label>
            <input style={s.formInput} placeholder="1.0.0" value={packVersion} onChange={(e) => setPackVersion(e.target.value)} />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>作者</label>
            <input style={s.formInput} placeholder="你的名字或团队" value={packAuthor} onChange={(e) => setPackAuthor(e.target.value)} />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>标签（逗号分隔）</label>
            <input style={s.formInput} placeholder="效率, 开发, 主题" value={packTags} onChange={(e) => setPackTags(e.target.value)} />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>宣传链接（视频/网址）</label>
            <input style={s.formInput} placeholder="BV号、抖音链接或自制网站" value={packPromoUrl} onChange={(e) => setPackPromoUrl(e.target.value)} />
          </div>
          <div style={s.formField}>
            <label style={s.formLabel}>兼容 DSH 版本</label>
            <input style={s.formInput} placeholder=">=0.2.0" value={packCompatible} onChange={(e) => setPackCompatible(e.target.value)} />
          </div>
        </div>
        <div style={{ ...s.formField, marginBottom: '14px' }}>
          <label style={s.formLabel}>描述</label>
          <textarea style={s.formTextarea} placeholder="这个插件包包含了什么，适合什么场景…" value={packDesc} onChange={(e) => setPackDesc(e.target.value)} />
        </div>
        <div style={{ ...s.formField, marginBottom: '14px' }}>
          <label style={s.formLabel}>注意事项</label>
          <textarea style={{ ...s.formTextarea, minHeight: '50px' }} placeholder="已知问题、依赖要求、使用提示等…" value={packNotes} onChange={(e) => setPackNotes(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button style={s.btn(true)} onClick={doExport} disabled={loading}>
            {loading ? '导出中…' : `导出插件包（已选 ${selected.size} 个）`}
          </button>
          {selected.size === 0 && <span style={{ fontSize: '12px', color: C.textMuted }}>请先在上方勾选插件</span>}
        </div>
        {exportedName && (
          <div style={s.success}>
            已导出 {exportedName}（离线插件包，浏览器已自动下载）
          </div>
        )}
        <div style={s.hint}>导出的 .dshpack 会打包不可移植插件的实体安装包，可移植插件保留原来源（导入时需联网下载）。不含密钥、会话或缓存。</div>
      </div>
    </div>
  )
}

// ---- Packs tab -----------------------------------------------------------

function PacksTab() {
  const [records, setRecords] = useState<PackRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [packPlugins, setPackPlugins] = useState<Record<string, PackPlugin[]>>({})
  const [detaching, setDetaching] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { const { records } = await packApi.listPacks(); setRecords(records.filter((r) => r.kind === 'imported')) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!packPlugins[id]) {
      try {
        const { plugins } = await packApi.getPackPlugins(id)
        setPackPlugins((prev) => ({ ...prev, [id]: plugins }))
      } catch (e) { setError((e as Error).message) }
    }
  }

  const detachPlugin = async (packId: string, pluginName: string) => {
    setDetaching(pluginName)
    try {
      await packApi.detachPlugin(packId, pluginName)
      setPackPlugins((prev) => ({
        ...prev,
        [packId]: (prev[packId] ?? []).map((p) => p.name === pluginName ? { ...p, detached: true } : p),
      }))
      setRecords((prev) => prev.map((r) => r.id === packId
        ? { ...r, detachedPlugins: [...(r.detachedPlugins ?? []), pluginName] }
        : r))
    } catch (e) { setError((e as Error).message) }
    finally { setDetaching('') }
  }

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
    setConfirmingDeleteId('')
  }

  const submitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(''); return }
    try { await packApi.renamePack(renamingId, renameValue.trim()); setRenamingId(''); await refresh() }
    catch (e) { setError((e as Error).message) }
  }

  const deletePack = async (id: string) => {
    try { await packApi.deletePack(id); setConfirmingDeleteId(''); setExpandedId(null); await refresh() }
    catch (e) { setError((e as Error).message) }
  }

  const isModified = (r: PackRecord) => (r.detachedPlugins?.length ?? 0) > 0

  return (
    <div>
      <div style={s.toolbar}>
        <button style={s.btn()} onClick={() => void refresh()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
        <span style={{ fontSize: '13px', color: C.textSecondary }}>共 {records.length} 个插件包</span>
      </div>
      {error && <div style={s.error}>{error}</div>}
      {records.length > 0 ? records.map((r) => {
        const modified = isModified(r)
        const plugins = packPlugins[r.id]
        return (
        <div key={r.id} style={s.packCard}>
          <div style={s.packHeader}>
            <span style={{ ...s.packName, cursor: 'pointer' }} onClick={() => void toggleExpand(r.id)}>
              {r.portableCount !== undefined && (
                <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: '8px', verticalAlign: 'middle' }}>
                  <span
                    title={
                      r.portableCount === r.pluginCount
                        ? '全部插件从远程源安装，包体轻量'
                        : r.portableCount === 0
                          ? '全部插件已打包进包，离线可装'
                          : `${r.portableCount} 个在线源 + ${r.pluginCount - r.portableCount} 个离线包`
                    }
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      marginRight: '5px',
                      background:
                        r.portableCount === r.pluginCount
                          ? C.success
                          : r.portableCount === 0
                            ? C.warning
                            : C.textMuted,
                    }}
                  />
                  <span style={{ fontSize: '12px', color: C.textSecondary, fontWeight: 500 }}>
                    {r.portableCount === r.pluginCount ? '在线包' : r.portableCount === 0 ? '离线包' : '混合包'}
                  </span>
                </span>
              )}
              {r.name}
              {r.version && <span style={{ fontSize: '11px', color: C.textMuted, fontFamily: 'ui-monospace, monospace', marginLeft: '6px' }}>v{r.version}</span>}
              {r.author && <span style={{ fontSize: '11px', color: C.textMuted, marginLeft: '8px' }}>by {r.author}</span>}
              <span style={{ fontSize: '11px', color: C.textMuted, marginLeft: '6px' }}>
                {expandedId === r.id ? '▼' : '▶'}
              </span>
            </span>
            <span style={s.badge(C.textSecondary, C.accentLight)}>{r.pluginCount} 插件</span>
            {modified && <span style={s.badge(C.warning, C.warningLight)}>已修改</span>}
            <span style={s.packMeta}>{new Date(r.createdAt).toLocaleString()}</span>
            <span style={s.packActions}>
              {modified ? (
                <span style={{ ...s.btnSm, color: C.textMuted, cursor: 'not-allowed', opacity: 0.5 }} title="包已修改，无法下载原始文件">下载</span>
              ) : (
                <a href={packApi.downloadUrl(r.id)} download style={s.btnSm}>下载</a>
              )}
              {renamingId === r.id ? (
                <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input style={s.inputSm} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitRename() }} autoFocus />
                  <button style={{ ...s.btnSm, background: C.accent, color: '#fff', borderColor: C.accent }} onClick={() => void submitRename()}>确定</button>
                  <button style={s.btnSm} onClick={() => setRenamingId('')}>取消</button>
                </span>
              ) : (
                <button style={s.btnSm} onClick={() => startRename(r.id, r.name)}>重命名</button>
              )}
              {confirmingDeleteId === r.id ? (
                <button style={{ ...s.btnSmDanger, background: C.danger, color: '#fff' }} onClick={() => void deletePack(r.id)}>确认删除</button>
              ) : (
                <button style={s.btnSmDanger} onClick={() => { setConfirmingDeleteId(r.id); setRenamingId('') }}>删除</button>
              )}
              {confirmingDeleteId === r.id && (
                <button style={s.btnSm} onClick={() => setConfirmingDeleteId('')}>取消</button>
              )}
            </span>
          </div>
          {confirmingDeleteId === r.id && (
            <div style={{
              marginTop: '10px', padding: '12px 14px', background: C.dangerLight,
              borderRadius: C.radiusSm, border: `1px solid #ffcecb`,
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: C.danger, marginBottom: '4px' }}>
                确认删除此插件包？
              </div>
              <div style={{ fontSize: '12px', color: C.textSecondary, lineHeight: 1.6 }}>
                将卸载包内 {plugins ? plugins.filter((p) => !p.detached).length : r.pluginCount} 个仍关联的插件
                {modified && `（${r.detachedPlugins?.length ?? 0} 个已移除的插件不受影响）`}，并删除插件包记录。
              </div>
            </div>
          )}
          {expandedId === r.id && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${C.borderLight}` }}>
              {/* Pack metadata */}
              {(r.description || r.notes || r.version || r.author || r.tags?.length || r.promoUrl || r.compatible) && (
                <div style={{ marginBottom: '14px', padding: '10px 12px', background: C.surface, borderRadius: C.radiusSm }}>
                  {r.description && (
                    <div style={{ fontSize: '12px', color: C.textSecondary, lineHeight: 1.6, marginBottom: '6px' }}>{r.description}</div>
                  )}
                  {r.notes && (
                    <div style={{ fontSize: '12px', color: C.warning, lineHeight: 1.6, marginBottom: '6px', padding: '6px 8px', background: C.warningLight, borderRadius: '4px' }}>
                      <span style={{ fontWeight: 600 }}>注意事项：</span>{r.notes}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '11px', color: C.textMuted }}>
                    {r.version && <span>版本 <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textSecondary }}>{r.version}</span></span>}
                    {r.author && <span>作者 <span style={{ color: C.textSecondary }}>{r.author}</span></span>}
                    {r.compatible && <span>兼容 <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textSecondary }}>{r.compatible}</span></span>}
                    {r.promoUrl && (() => {
                      const isBv = /^bv/i.test(r.promoUrl.trim())
                      const href = isBv
                        ? `https://www.bilibili.com/video/${r.promoUrl.trim()}`
                        : /^https?:\/\//i.test(r.promoUrl.trim())
                          ? r.promoUrl.trim()
                          : `https://${r.promoUrl.trim()}`
                      const label = isBv ? `B站 ${r.promoUrl.trim()}` : r.promoUrl.trim()
                      return (
                        <span>宣传 <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>{label.length > 40 ? label.slice(0, 40) + '…' : label}</a></span>
                      )
                    })()}
                  </div>
                  {r.tags && r.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                      {r.tags.map((t) => (
                        <span key={t} style={{ ...s.badge(C.textSecondary, C.accentLight), fontSize: '10px' }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!plugins ? (
                <div style={{ fontSize: '12px', color: C.textMuted }}>加载中…</div>
              ) : (
                <div>
                  <div style={{ fontSize: '12px', color: C.textSecondary, marginBottom: '8px' }}>
                    包内插件（{plugins.filter((p) => !p.detached).length} 个关联中，{plugins.filter((p) => p.detached).length} 个已移除）
                  </div>
                  {plugins.map((p) => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{p.name}</span>
                      {p.version && <span style={{ fontSize: '11px', color: C.textMuted, fontFamily: 'ui-monospace, monospace' }}>v{p.version}</span>}
                      {p.detached ? (
                        <span style={{ ...s.badge(C.textMuted, C.accentLight), marginLeft: 'auto' }}>已移除</span>
                      ) : (
                        <button
                          style={{ ...s.btnSm, marginLeft: 'auto', color: C.warning, borderColor: C.warning }}
                          onClick={() => void detachPlugin(r.id, p.name)}
                          disabled={detaching === p.name}
                        >
                          {detaching === p.name ? '移除中…' : '从包中移除'}
                        </button>
                      )}
                    </div>
                  ))}
                  <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '8px', lineHeight: 1.5 }}>
                    「从包中移除」后插件仍保持安装，但不再属于此插件包；删除插件包时不会卸载已移除的插件。
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}) : (
        !loading && <div style={s.empty}>还没有导入过插件包，去「导入」标签页选择 .dshpack 文件安装吧。</div>
      )}
    </div>
  )
}

// ---- Import tab ----------------------------------------------------------

function ImportTab() {
  const [binary, setBinary] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [force, setForce] = useState(false)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImportResult(null)
    setError('')
    setProgress(null)
    const reader = new FileReader()
    reader.onload = () => { setBinary(reader.result as ArrayBuffer) }
    reader.onerror = () => setError('读取文件失败')
    reader.readAsArrayBuffer(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const doImport = async () => {
    if (!binary) { setError('请先选择 .dshpack 插件包文件'); return }
    setLoading(true); setError(''); setImportResult(null); setProgress(null)
    try {
      const res = await packApi.importBundleStream(binary, force, (index, total, name) => {
        setProgress({ index, total, name })
      })
      setImportResult(res)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false); setProgress(null) }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div>
      <h3 style={s.sectionTitle}>导入插件包</h3>
      <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '10px' }}>
        选择 <code style={{ background: C.surface, padding: '1px 5px', borderRadius: '4px', fontSize: '12px' }}>.dshpack</code> 插件包文件，不可移植插件从包内离线安装，可移植插件从原来源联网下载，通过 DSH 官方 pluginManager 批量安装。
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dshpack,.tar.gz,.tgz"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button style={s.btn()} onClick={() => fileInputRef.current?.click()}>选择文件</button>
        {fileName && binary && (
          <span style={{ fontSize: '13px', color: C.textSecondary }}>
            已选：{fileName}（{formatSize(binary.byteLength)}）
          </span>
        )}
      </div>
      <div style={{ ...s.toolbar, marginTop: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: C.textSecondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          强制重装（已安装的也重新装）
        </label>
        <button style={s.btn(true)} onClick={() => void doImport()} disabled={loading || !binary}>
          {loading ? '导入中…' : '导入并安装'}
        </button>
      </div>
      {error && <div style={{ ...s.error, marginTop: '12px' }}>{error}</div>}

      {/* Installation progress */}
      {loading && progress && (
        <div style={{ ...s.packCard, marginTop: '16px', background: C.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <span style={{
              display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
              border: `2px solid ${C.border}`, borderTopColor: C.accent,
              animation: 'spin 0.8s linear infinite',
            }} />
            <strong style={{ fontSize: '13px' }}>正在安装：{progress.name}</strong>
            <span style={{ fontSize: '12px', color: C.textMuted, marginLeft: 'auto' }}>
              {progress.index + 1} / {progress.total}
            </span>
          </div>
          <div style={{ width: '100%', height: '6px', background: C.borderLight, borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${((progress.index + 1) / progress.total) * 100}%`,
              height: '100%', background: C.accent, borderRadius: '3px',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}
      {loading && !progress && (
        <div style={{ ...s.packCard, marginTop: '16px', background: C.surface, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
            border: `2px solid ${C.border}`, borderTopColor: C.accent,
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ fontSize: '13px', color: C.textSecondary }}>正在准备安装…</span>
        </div>
      )}

      {/* Import result with per-plugin detail */}
      {importResult && (
        <div style={{ ...s.packCard, marginTop: '16px', background: C.surface }}>
          <h4 style={{ fontSize: '14px', margin: '0 0 10px 0' }}>
            导入结果：{importResult.pack.name}
          </h4>
          {importResult.restartRequired && (
            <div style={{ color: C.warning, background: C.warningLight, padding: '8px 12px', borderRadius: C.radiusSm, marginBottom: '10px', fontSize: '13px', fontWeight: 500 }}>
              部分插件需要重启 DSH 后才能生效。
            </div>
          )}
          {importResult.installed.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                安装结果（{importResult.installed.filter((i) => i.success).length} 成功 / {importResult.installed.filter((i) => !i.success).length} 失败）：
              </div>
              {importResult.installed.map((item) => (
                <div key={item.name} style={{ ...s.listItem, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '1px 8px', borderRadius: '10px', flexShrink: 0,
                    background: item.success ? C.successLight : C.dangerLight,
                    color: item.success ? C.success : C.danger,
                  }}>
                    {item.success ? (item.application === 'restart-required' ? '需重启' : '成功') : '失败'}
                  </span>
                  <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</strong>
                  <span style={{ fontSize: '11px', color: C.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.spec.startsWith('file:') ? '离线包安装' : `官方安装：${item.spec}`}
                  </span>
                  {item.error && <span style={{ fontSize: '12px', color: C.danger, flexBasis: '100%', paddingLeft: '32px', lineHeight: 1.5 }}>{item.error}</span>}
                </div>
              ))}
            </div>
          )}
          {importResult.skipped.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: C.textSecondary, marginBottom: '6px' }}>跳过（{importResult.skipped.length}）：</div>
              {importResult.skipped.map((item) => (
                <div key={item.name} style={{ ...s.listItem, color: C.textSecondary, fontSize: '12px' }}>
                  {item.name} — {item.reason}
                </div>
              ))}
            </div>
          )}
          {importResult.warnings.length > 0 && (
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: C.warning, marginBottom: '6px' }}>警告：</div>
              {importResult.warnings.map((w, i) => (
                <div key={i} style={{ ...s.listItem, color: C.warning, fontSize: '12px' }}>{w}</div>
              ))}
            </div>
          )}
          {importResult.installed.length === 0 && importResult.skipped.length > 0 && (
            <div style={s.hint}>没有安装任何插件（全部跳过）。可勾选「强制重装」后重试。</div>
          )}
        </div>
      )}
    </div>
  )
}
