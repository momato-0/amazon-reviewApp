import { useState, useEffect, useCallback, useRef } from 'react'

type Field = {
  name: string
  words: string[]
}

type Template = {
  id: string
  name: string
  fields: Field[]
  builtin?: boolean
}

const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'anything',
    name: 'なんでも',
    builtin: true,
    fields: [
      { name: '使用感', words: [] },
      { name: '耐久性', words: [] },
      { name: '気づき', words: [] },
    ],
  },
  {
    id: 'shampoo',
    name: 'シャンプー',
    builtin: true,
    fields: [
      { name: 'テクスチャ', words: ['白くて', '透明、', 'たぷたぷ', '水より少しとろりと', '水のようにさらさら'] },
      { name: '香り', words: ['上品', 'ふわっと', 'あまり残らなそう。', '強い'] },
      { name: '泡立ち', words: ['私は脂性肌だが、', 'もちもち', 'よく泡立つ'] },
    ],
  },
  {
    id: 'conditioner',
    name: 'コンディショナー',
    builtin: true,
    fields: [
      { name: 'テクスチャ', words: ['白くて', '透明、', 'たぷたぷ', '水より少しとろりと', '水のようにさらさら'] },
      { name: '香り', words: ['上品', 'ふわっと', 'あまり残らなそう。', '強い'] },
      { name: '洗ってみた', words: ['するすると髪に行き渡る。'] },
      { name: 'ドライヤー後', words: [] },
    ],
  },
  {
    id: 'tools',
    name: '工具',
    builtin: true,
    fields: [
      { name: '使用感', words: [] },
      { name: '耐久性', words: ['頑丈', 'しっかりしている。'] },
    ],
  },
]

const STORAGE_KEY = 'vine_all_templates_v2'
const REVIEWS_STORAGE_KEY = 'vine_saved_reviews_v1'

type SavedReview = {
  id: string
  content: string
  templateName: string
  createdAt: number
}

// 旧バージョン（fieldsが文字列配列）のデータも読み込めるように変換
function normalizeField(f: unknown): Field {
  if (typeof f === 'string') return { name: f, words: [] }
  const obj = f as Partial<Field>
  return { name: obj.name ?? '', words: Array.isArray(obj.words) ? obj.words : [] }
}

function normalizeTemplate(t: any): Template {
  return {
    id: t.id,
    name: t.name,
    builtin: t.builtin,
    fields: Array.isArray(t.fields) ? t.fields.map(normalizeField) : [],
  }
}

function loadTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return BUILTIN_TEMPLATES
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return BUILTIN_TEMPLATES
    // 未編集の標準テンプレートは常に最新のコード定義を使う（保存済みキャッシュで古い項目が残るのを防ぐ）
    return parsed.map(t => {
      const normalized = normalizeTemplate(t)
      if (normalized.builtin) {
        const latest = BUILTIN_TEMPLATES.find(b => b.id === normalized.id)
        if (latest) return latest
      }
      return normalized
    })
  } catch {
    return BUILTIN_TEMPLATES
  }
}

function saveTemplates(templates: Template[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

function loadSavedReviews(): SavedReview[] {
  try {
    const raw = localStorage.getItem(REVIEWS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSavedReviews(reviews: SavedReview[]) {
  localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(reviews))
}

type BackupData = {
  templates: Template[]
  savedReviews: SavedReview[]
  exportedAt: number
}

function parseBackupData(raw: string): BackupData | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const templates = Array.isArray(parsed.templates) ? parsed.templates.map(normalizeTemplate) : []
    const savedReviews = Array.isArray(parsed.savedReviews)
      ? parsed.savedReviews.filter((r: unknown) => r && typeof r === 'object' && typeof (r as SavedReview).content === 'string')
      : []
    if (templates.length === 0) return null
    return { templates, savedReviews, exportedAt: Date.now() }
  } catch {
    return null
  }
}

// ② 全角読点（、）区切りで項目名をパース
function parseFields(input: string): string[] {
  return input.split('、').map(s => s.trim()).filter(Boolean)
}

// 全角スペース（　）区切りでよく使う言葉をパース
function parseWords(input: string): string[] {
  return input.split('　').map(s => s.trim()).filter(Boolean)
}

export default function App() {
  const [tab, setTab] = useState<'write' | 'manage'>('write')
  const [templates, setTemplates] = useState<Template[]>(loadTemplates)
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? 'anything')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const [savedReviews, setSavedReviews] = useState<SavedReview[]>(loadSavedReviews)
  const [reviewSaved, setReviewSaved] = useState(false)
  const [copiedReviewId, setCopiedReviewId] = useState<string | null>(null)

  // バックアップ（エクスポート／インポート）
  const importInputRef = useRef<HTMLInputElement>(null)
  const [exportedMsg, setExportedMsg] = useState(false)
  const [importError, setImportError] = useState('')
  const [importedMsg, setImportedMsg] = useState(false)

  // Template builder state
  const [newName, setNewName] = useState('')
  const [newFields, setNewFields] = useState('')
  const [buildError, setBuildError] = useState('')
  const [savedMsg, setSavedMsg] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editFields, setEditFields] = useState<{ name: string; words: string }[]>([])

  // ③ フォームに後から追加できる自由項目
  const [extraFields, setExtraFields] = useState<{ id: string; title: string; text: string }[]>([])

  const currentTemplate = templates.find(t => t.id === selectedId) ?? templates[0]

  useEffect(() => {
    if (!currentTemplate) return
    const init: Record<string, boolean> = {}
    const initT: Record<string, string> = {}
    currentTemplate.fields.forEach(f => { init[f.name] = true; initT[f.name] = '' })
    setChecked(init)
    setTexts(initT)
    setExtraFields([])
  }, [selectedId, templates])

  const output = [
    ...(currentTemplate?.fields ?? [])
      .filter(f => checked[f.name])
      .map(f => `【${f.name}】\n${texts[f.name] || ''}`),
    ...extraFields
      .filter(f => f.title.trim())
      .map(f => `【${f.title.trim()}】\n${f.text || ''}`),
  ].join('\n\n')

  const handleWordClick = (fieldName: string, word: string) => {
    setChecked(ch => ({ ...ch, [fieldName]: true }))
    setTexts(t => ({ ...t, [fieldName]: (t[fieldName] ?? '') + word }))
  }

  const addExtraField = () => {
    setExtraFields(ef => [...ef, { id: `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title: '', text: '' }])
  }

  const updateExtraField = (id: string, patch: Partial<{ title: string; text: string }>) => {
    setExtraFields(ef => ef.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }

  const removeExtraField = (id: string) => {
    setExtraFields(ef => ef.filter(f => f.id !== id))
  }

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [output])

  const handleSaveReview = () => {
    if (!output.trim()) return
    const entry: SavedReview = {
      id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      content: output,
      templateName: currentTemplate?.name ?? '',
      createdAt: Date.now(),
    }
    const next = [entry, ...savedReviews]
    setSavedReviews(next)
    saveSavedReviews(next)
    setReviewSaved(true)
    setTimeout(() => setReviewSaved(false), 2000)
  }

  const handleCopySavedReview = useCallback(async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedReviewId(id)
      setTimeout(() => setCopiedReviewId(cur => (cur === id ? null : cur)), 2000)
    } catch {}
  }, [])

  const handleDeleteSavedReview = (id: string) => {
    setSavedReviews(cur => {
      const next = cur.filter(r => r.id !== id)
      saveSavedReviews(next)
      return next
    })
  }

  const handleExportBackup = () => {
    const data: BackupData = { templates, savedReviews, exportedAt: Date.now() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `vine-review-backup_${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExportedMsg(true)
    setTimeout(() => setExportedMsg(false), 2000)
  }

  const handleImportClick = () => {
    setImportError('')
    importInputRef.current?.click()
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = parseBackupData(String(reader.result ?? ''))
      if (!data) {
        setImportError('ファイルを読み込めませんでした。正しいバックアップファイルか確認してください。')
        return
      }
      setTemplates(data.templates)
      saveTemplates(data.templates)
      setSavedReviews(data.savedReviews)
      saveSavedReviews(data.savedReviews)
      setSelectedId(data.templates[0]?.id ?? '')
      setImportError('')
      setImportedMsg(true)
      setTimeout(() => setImportedMsg(false), 2000)
    }
    reader.onerror = () => setImportError('ファイルの読み込み中にエラーが発生しました。')
    reader.readAsText(file)
  }

  const handleSaveTemplate = () => {
    const name = newName.trim()
    const fieldNames = parseFields(newFields)
    if (!name) { setBuildError('カテゴリ名を入力してください'); return }
    if (fieldNames.length === 0) { setBuildError('項目を1つ以上入力してください'); return }
    const id = `custom_${Date.now()}`
    const fields: Field[] = fieldNames.map(n => ({ name: n, words: [] }))
    const next = [...templates, { id, name, fields }]
    setTemplates(next)
    saveTemplates(next)
    setNewName('')
    setNewFields('')
    setBuildError('')
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
  }

  const handleDelete = (id: string) => {
    const next = templates.filter(t => t.id !== id)
    setTemplates(next)
    saveTemplates(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? '')
  }

  const startEdit = (t: Template) => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditFields(t.fields.map(f => ({ name: f.name, words: f.words.join('　') })))
  }

  const updateEditField = (i: number, patch: Partial<{ name: string; words: string }>) => {
    setEditFields(fs => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    const name = editName.trim()
    const fields: Field[] = editFields
      .map(f => ({ name: f.name.trim(), words: parseWords(f.words) }))
      .filter(f => f.name)
    if (!name || fields.length === 0) return
    const next = templates.map(t => t.id === editingId ? { ...t, name, fields, builtin: false } : t)
    setTemplates(next)
    saveTemplates(next)
    setEditingId(null)
  }

  // ダークモード用カラー定数
  const c = {
    bg: '#111110',
    surface: '#1c1c1a',
    surfaceAlt: '#242422',
    border: '#2e2e2c',
    divider: '#232321',
    accent: '#f05f16',
    accentMuted: '#2a1a10',
    text: '#f0efec',
    muted: '#7a7a74',
    placeholder: '#4a4a46',
  }

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, fontFamily: "'Noto Sans JP', sans-serif" }} className="flex flex-col">
      {/* Header */}
      <header style={{ background: c.surface, borderBottom: `1px solid ${c.border}` }} className="px-4 pt-4 pb-0 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-3">
          <div style={{ background: c.accent }} className="w-7 h-7 rounded-lg flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3h10M2 7h7M2 11h5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-[15px] font-bold tracking-tight">Vine レビューライター</h1>
        </div>
        <div className="flex">
          {(['write', 'manage'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                borderBottom: `2px solid ${tab === t ? c.accent : 'transparent'}`,
                color: tab === t ? c.accent : c.muted,
              }}
              className="flex-1 py-2 text-[13px] font-semibold transition-colors"
            >
              {t === 'write' ? '✍️ レビュー執筆' : '⚙️ テンプレート管理'}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 flex flex-col gap-4 max-w-lg mx-auto w-full">
        {tab === 'write' ? (
          <>
            {/* Category selector */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl p-4">
              <label style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest mb-2 block">カテゴリ</label>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                className="w-full rounded-xl px-3 py-2.5 text-[14px] font-medium appearance-none focus:outline-none"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Review fields */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">執筆フォーム</span>
              </div>
              <div>
                {(currentTemplate?.fields ?? []).map((field, i) => (
                  <div key={field.name} style={{ borderTop: i > 0 ? `1px solid ${c.divider}` : 'none' }} className="px-4 py-3">
                    <label className="flex items-center gap-2.5 cursor-pointer mb-2">
                      <div
                        onClick={() => setChecked(ch => ({ ...ch, [field.name]: !ch[field.name] }))}
                        style={{
                          background: checked[field.name] ? c.accent : 'transparent',
                          border: `2px solid ${checked[field.name] ? c.accent : c.muted}`,
                        }}
                        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                      >
                        {checked[field.name] && (
                          <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                            <path d="M1 4l3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span className="text-[14px] font-semibold">{field.name}</span>
                    </label>
                    {field.words.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {field.words.map((word, wi) => (
                          <button
                            key={`${word}_${wi}`}
                            type="button"
                            onClick={() => handleWordClick(field.name, word)}
                            style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.muted }}
                            className="px-2.5 py-1 rounded-lg text-[12px] active:scale-95 transition-transform"
                          >
                            {word}
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      rows={2}
                      value={texts[field.name] ?? ''}
                      onChange={e => setTexts(t => ({ ...t, [field.name]: e.target.value }))}
                      placeholder={`${field.name}について記入…`}
                      disabled={!checked[field.name]}
                      style={{
                        background: checked[field.name] ? c.surfaceAlt : c.divider,
                        border: `1px solid ${c.border}`,
                        color: checked[field.name] ? c.text : c.placeholder,
                      }}
                      className="w-full rounded-xl px-3 py-2 text-[13px] leading-relaxed focus:outline-none transition-all"
                    />
                  </div>
                ))}

                {/* ③ 後から追加した自由項目 */}
                {extraFields.map((f) => (
                  <div key={f.id} style={{ borderTop: `1px solid ${c.divider}` }} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        value={f.title}
                        onChange={e => updateExtraField(f.id, { title: e.target.value })}
                        placeholder="タイトルを入力"
                        style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                        className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold focus:outline-none"
                      />
                      <button
                        onClick={() => removeExtraField(f.id)}
                        style={{ background: '#2a1515', color: '#f87171' }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform text-[13px]"
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={f.text}
                      onChange={e => updateExtraField(f.id, { text: e.target.value })}
                      placeholder="内容を記入…"
                      style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                      className="w-full rounded-xl px-3 py-2 text-[13px] leading-relaxed focus:outline-none"
                    />
                  </div>
                ))}

                <div style={{ borderTop: `1px solid ${c.divider}` }} className="px-4 py-3">
                  <button
                    onClick={addExtraField}
                    style={{ background: c.surfaceAlt, border: `1px dashed ${c.border}`, color: c.muted }}
                    className="w-full py-2.5 rounded-xl text-[13px] font-semibold active:scale-95 transition-transform"
                  >
                    ＋ 項目を追加
                  </button>
                </div>
              </div>
            </div>

            {/* Output */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">プレビュー</span>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!output.trim()}
                    style={{
                      background: copied ? '#22c55e' : output.trim() ? c.accent : c.border,
                      color: output.trim() ? 'white' : c.placeholder,
                    }}
                    className="px-4 py-1.5 rounded-xl text-[12px] font-bold transition-all active:scale-95"
                  >
                    {copied ? '✓ コピー済み' : '📋 コピー'}
                  </button>
                  <button
                    onClick={handleSaveReview}
                    disabled={!output.trim()}
                    style={{
                      background: reviewSaved ? '#22c55e' : output.trim() ? c.surfaceAlt : c.border,
                      border: `1px solid ${output.trim() ? c.border : c.border}`,
                      color: reviewSaved ? 'white' : output.trim() ? c.text : c.placeholder,
                    }}
                    className="px-4 py-1.5 rounded-xl text-[12px] font-bold transition-all active:scale-95"
                  >
                    {reviewSaved ? '✓ 保存済み' : '💾 保存'}
                  </button>
                </div>
              </div>
              <div className="px-4 py-3">
                {output.trim() ? (
                  <pre style={{ color: c.text }} className="text-[13px] leading-relaxed whitespace-pre-wrap font-[inherit]">{output}</pre>
                ) : (
                  <p style={{ color: c.placeholder }} className="text-[13px] py-2">チェックした項目が表示されます</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* バックアップ（エクスポート／インポート） */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">バックアップ</span>
              </div>
              <div className="px-4 py-4 flex flex-col gap-3">
                <p style={{ color: c.muted }} className="text-[12px] leading-relaxed">
                  テンプレートと保存済レビューをファイルに書き出せます。キャッシュ削除や機種変更に備えて、定期的にエクスポートしておくことをおすすめします。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportBackup}
                    style={{ background: exportedMsg ? '#22c55e' : c.accent }}
                    className="flex-1 py-2.5 text-white font-bold text-[13px] rounded-xl active:scale-95 transition-transform"
                  >
                    {exportedMsg ? '✓ 書き出しました' : '📤 エクスポート'}
                  </button>
                  <button
                    onClick={handleImportClick}
                    style={{ background: importedMsg ? '#22c55e' : c.surfaceAlt, border: `1px solid ${c.border}`, color: importedMsg ? 'white' : c.text }}
                    className="flex-1 py-2.5 font-bold text-[13px] rounded-xl active:scale-95 transition-transform"
                  >
                    {importedMsg ? '✓ 復元しました' : '📥 インポート'}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                </div>
                {importError && <p className="text-[12px] text-red-400 font-medium">{importError}</p>}
                <p style={{ color: c.placeholder }} className="text-[11px]">
                  インポートすると、現在のテンプレートと保存済レビューはファイルの内容で置き換えられます。
                </p>
              </div>
            </div>

            {/* 保存済レビュー */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">
                  保存済レビュー（{savedReviews.length}件）
                </span>
              </div>
              {savedReviews.length === 0 ? (
                <p style={{ color: c.placeholder }} className="text-[13px] px-4 py-3">保存されたレビューはありません</p>
              ) : (
                <div>
                  {savedReviews.map((r, i) => (
                    <div key={r.id} style={{ borderTop: i > 0 ? `1px solid ${c.divider}` : 'none' }} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate">{r.templateName || '無題'}</p>
                        <p style={{ color: c.muted }} className="text-[12px] mt-0.5 truncate">{r.content.replace(/\n/g, ' ')}</p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => handleCopySavedReview(r.id, r.content)}
                          style={{
                            background: copiedReviewId === r.id ? '#22c55e' : c.surfaceAlt,
                            color: copiedReviewId === r.id ? 'white' : c.muted,
                          }}
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
                        >
                          {copiedReviewId === r.id ? (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M1 7l3.5 3.5L13 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M4.5 1.75h4.086a.75.75 0 0 1 .53.22l1.914 1.914a.75.75 0 0 1 .22.53V11.5a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1-.75-.75v-9a.75.75 0 0 1 .75-.75z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              <path d="M8.25 1.9V4a.75.75 0 0 0 .75.75h2.1" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteSavedReview(r.id)}
                          style={{ background: '#2a1515', color: '#f87171' }}
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
                        >
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M1.75 3.5h10.5M5.25 3.5V2.625a.875.875 0 0 1 .875-.875h1.75a.875.875 0 0 1 .875.875V3.5m1.312 0L9.625 11.375a.875.875 0 0 1-.875.875H5.25a.875.875 0 0 1-.875-.875L3.938 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Template builder */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">新規テンプレートを作成</span>
              </div>
              <div className="px-4 py-4 flex flex-col gap-3">
                <div>
                  <label style={{ color: c.muted }} className="text-[12px] font-semibold mb-1.5 block">カテゴリ名</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="例：化粧水"
                    style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] focus:outline-none"
                  />
                </div>
                <div>
                  <label style={{ color: c.muted }} className="text-[12px] font-semibold mb-1.5 block">項目（全角読点「、」区切り）</label>
                  <input
                    type="text"
                    value={newFields}
                    onChange={e => setNewFields(e.target.value)}
                    placeholder="例：保湿力、香り、伸び、肌なじみ"
                    style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] focus:outline-none"
                  />
                  <p style={{ color: c.placeholder }} className="text-[11px] mt-1">全角読点（、）で項目を区切ってください</p>
                </div>
                {buildError && <p className="text-[12px] text-red-400 font-medium">{buildError}</p>}
                <button
                  onClick={handleSaveTemplate}
                  style={{ background: c.accent }}
                  className="w-full py-3 text-white font-bold text-[14px] rounded-xl active:scale-95 transition-transform"
                >
                  {savedMsg ? '✓ 保存しました！' : '保存する'}
                </button>
              </div>
            </div>

            {/* ③ 全テンプレート（組み込み含む）を一覧・編集可能に */}
            <div style={{ background: c.surface, border: `1px solid ${c.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ borderBottom: `1px solid ${c.divider}` }} className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span style={{ color: c.muted }} className="text-[11px] font-semibold uppercase tracking-widest">
                  テンプレート一覧（{templates.length}件）
                </span>
              </div>
              <div>
                {templates.map((t, i) => (
                  <div key={t.id} style={{ borderTop: i > 0 ? `1px solid ${c.divider}` : 'none' }} className="px-4 py-3">
                    {editingId === t.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                          className="w-full rounded-xl px-3 py-2 text-[13px] focus:outline-none"
                          placeholder="カテゴリ名"
                        />
                        <div className="flex flex-col gap-2">
                          {editFields.map((f, fi) => (
                            <div key={fi} style={{ background: c.divider }} className="rounded-xl p-2 flex flex-col gap-1.5">
                              <input
                                value={f.name}
                                onChange={e => updateEditField(fi, { name: e.target.value })}
                                style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                                className="w-full rounded-lg px-2.5 py-1.5 text-[12px] font-semibold focus:outline-none"
                                placeholder="項目名"
                              />
                              <input
                                value={f.words}
                                onChange={e => updateEditField(fi, { words: e.target.value })}
                                style={{ background: c.surfaceAlt, border: `1px solid ${c.border}`, color: c.text }}
                                className="w-full rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
                                placeholder="よく使う言葉（全角スペース区切り）"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            style={{ background: c.accent }}
                            className="flex-1 py-2 text-white text-[13px] font-bold rounded-xl active:scale-95 transition-transform"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ background: c.surfaceAlt, color: c.muted }}
                            className="flex-1 py-2 text-[13px] font-semibold rounded-xl active:scale-95 transition-transform"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[14px] font-semibold truncate">{t.name}</p>
                            {t.builtin && (
                              <span style={{ background: c.accentMuted, color: c.accent }} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0">標準</span>
                            )}
                          </div>
                          <p style={{ color: c.muted }} className="text-[12px] mt-0.5 truncate">{t.fields.map(f => f.name).join('・')}</p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => startEdit(t)}
                            style={{ background: c.surfaceAlt, color: c.muted }}
                            className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            style={{ background: '#2a1515', color: '#f87171' }}
                            className="w-8 h-8 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M1.75 3.5h10.5M5.25 3.5V2.625a.875.875 0 0 1 .875-.875h1.75a.875.875 0 0 1 .875.875V3.5m1.312 0L9.625 11.375a.875.875 0 0 1-.875.875H5.25a.875.875 0 0 1-.875-.875L3.938 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
      <div className="h-6" />
    </div>
  )
}
