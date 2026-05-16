import { useState, useEffect, useRef } from 'react'
import { Sparkles, Loader2, X, ArrowLeft, RefreshCw, Copy, Download, Trash2, RotateCcw, Square, LogIn, LogOut, UserPlus } from 'lucide-react'
import './App.css'

const API_BASE = 'http://127.0.0.1:3001/api'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function App() {
  // Auth state
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('vibe_token'))
  const [authView, setAuthView] = useState('login') // 'login' | 'register'
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  // App state
  const [seed, setSeed] = useState('')
  const [generating, setGenerating] = useState(false)
  const [logs, setLogs] = useState([])
  const [works, setWorks] = useState([])
  const [activeWork, setActiveWork] = useState(null)
  const [activeWorkHtml, setActiveWorkHtml] = useState('')
  const [loadingWork, setLoadingWork] = useState(false)
  const [lastSeed, setLastSeed] = useState('')
  const [filter, setFilter] = useState('all')
  const [currentIteration, setCurrentIteration] = useState(0)
  const esRef = useRef(null)
  const logsEndRef = useRef(null)
  const previewRef = useRef(null)

  // ─── Auth helpers ────────────────────────────────────────────────────

  function authHeaders() {
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  function saveAuth(t, u) {
    setToken(t)
    setUser(u)
    localStorage.setItem('vibe_token', t)
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE}/auth/session`, { method: 'DELETE', headers: authHeaders() })
    } catch { /* ignore */ }
    setToken(null)
    setUser(null)
    setWorks([])
    setLogs([])
    setSeed('')
    setActiveWork(null)
    setActiveWorkHtml('')
    localStorage.removeItem('vibe_token')
  }

  async function handleAuth(e) {
    e.preventDefault()
    if (authLoading) return
    setAuthError('')
    setAuthLoading(true)

    const endpoint = authView === 'register' ? 'register' : 'login'
    try {
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || '操作失败')
      } else {
        saveAuth(data.token, data.user)
        setAuthUsername('')
        setAuthPassword('')
      }
    } catch {
      setAuthError('网络错误，请重试')
    }
    setAuthLoading(false)
  }

  // ─── Check saved token on mount ─────────────────────────────────────

  useEffect(() => {
    if (!token) { setCheckingAuth(false); return }
    fetch(`${API_BASE}/auth/me`, { headers: authHeaders() })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => { setUser(data.user); setCheckingAuth(false) })
      .catch(() => {
        localStorage.removeItem('vibe_token')
        setToken(null)
        setCheckingAuth(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-scroll logs to bottom ─────────────────────────────────────

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ─── Load works on auth ─────────────────────────────────────────────

  useEffect(() => {
    if (user) loadWorks()
  }, [user])

  async function loadWorks() {
    try {
      const res = await fetch(`${API_BASE}/works`, { headers: authHeaders() })
      if (res.status === 401) { handleLogout(); return }
      const data = await res.json()
      setWorks(data.works || [])
    } catch { setWorks([]) }
  }

  async function loadWorkContent(filename) {
    setLoadingWork(true)
    try {
      const res = await fetch(`${API_BASE}/works/${filename}`, { headers: authHeaders() })
      if (res.ok) setActiveWorkHtml(await res.text())
    } catch { setActiveWorkHtml('') }
    setLoadingWork(false)
  }

  async function deleteWork(filename, e) {
    e.stopPropagation()
    try {
      await fetch(`${API_BASE}/works/${filename}`, { method: 'DELETE', headers: authHeaders() })
      loadWorks()
    } catch { /* ignore */ }
  }

  function copyHtml() {
    if (activeWorkHtml) navigator.clipboard.writeText(activeWorkHtml)
  }

  function downloadHtml() {
    if (!activeWorkHtml || !activeWork) return
    const blob = new Blob([activeWorkHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeWork.filename || 'vibe.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleAbort() {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setGenerating(false)
    setLogs(prev => [...prev, { role: 'System', score: null, msg: '已取消生成' }])
  }

  function handleGenerate(retrySeed) {
    const text = (retrySeed || seed).trim()
    if (!text || generating) return

    setLastSeed(text)
    setGenerating(true)
    setLogs([])
    setCurrentIteration(0)

    // Close previous EventSource if any
    if (esRef.current) esRef.current.close()

    const es = new EventSource(
      `${API_BASE}/generate?seed=${encodeURIComponent(text)}&token=${encodeURIComponent(token)}`
    )
    esRef.current = es

    es.onmessage = (event) => {
      // Ignore keepalive pings
      if (!event.data || event.data.startsWith(':')) return
      let data
      try { data = JSON.parse(event.data) } catch { return }

      if (data.type === 'DONE') {
        es.close()
        esRef.current = null
        setGenerating(false)
        loadWorks() // auto-refresh gallery
        return
      }

      switch (data.type) {
        case 'step':
          if (data.iteration) setCurrentIteration(data.iteration)
          setLogs(prev => [...prev, { role: data.role, score: null, msg: data.msg }])
          break
        case 'score':
          setLogs(prev => [...prev, { role: data.role, score: data.score, msg: data.feedback }])
          break
        case 'done':
          setLogs(prev => [...prev, { role: 'Engine', score: data.score, msg: data.score >= 90 ? '作品通过审查' : '已达最大迭代次数，输出最终版本' }])
          break
        case 'result':
          setSeed('')
          if (data.html) {
            setActiveWork({ id: data.filename, title: '生成完成', filename: data.filename })
            setActiveWorkHtml(data.html)
          }
          break
        case 'error':
          setLogs(prev => [...prev, { role: 'Error', score: null, msg: data.msg }])
          break
      }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setGenerating(false)
      loadWorks() // refresh even on error — work may have been saved
    }
  }

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => { if (esRef.current) esRef.current.close() }
  }, [])

  const hasError = logs.some((l) => l.role === 'Error')

  const filteredWorks = works.filter((w) => {
    if (filter === 'drafts') return w.score != null && w.score < 90
    if (filter === 'passed') return w.score != null && w.score >= 90
    return true
  })

  // ─── Auth loading screen ────────────────────────────────────────────

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(170deg, #1c1a19 0%, #232120 40%, #1e1c1b 100%)' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#5e5349' }} />
      </div>
    )
  }

  // ─── Login / Register screen ────────────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'linear-gradient(170deg, #1c1a19 0%, #232120 40%, #1e1c1b 100%)' }}>
        <header className="text-center mb-8 sm:mb-10">
          <p className="text-xs tracking-widest uppercase mb-3 sm:mb-4" style={{ color: '#8a7e74', letterSpacing: '0.25em' }}>vibe creator engine</p>
          <h1 className="text-2xl sm:text-3xl font-extralight mb-2" style={{ color: '#d4c8bc' }}>自循环创意工作流引擎</h1>
          <p className="text-xs sm:text-sm font-light" style={{ color: '#7d7168' }}>
            {authView === 'login' ? '登录以继续创作' : '注册一个新身份'}
          </p>
        </header>

        <div className="w-full max-w-sm rounded-2xl px-6 py-8 sm:px-8 sm:py-10" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
          {/* Tab switcher */}
          <div className="flex items-center gap-2 mb-6 sm:mb-8">
            <button onClick={() => { setAuthView('login'); setAuthError('') }} className="flex-1 text-center text-xs py-2 rounded-lg font-light transition-all duration-300" style={{ color: authView === 'login' ? '#d4c8bc' : '#5e5349', background: authView === 'login' ? 'rgba(192,168,148,0.12)' : 'transparent', border: `1px solid ${authView === 'login' ? 'rgba(192,168,148,0.2)' : 'transparent'}` }}>
              <LogIn size={12} className="inline mr-1.5" />登录
            </button>
            <button onClick={() => { setAuthView('register'); setAuthError('') }} className="flex-1 text-center text-xs py-2 rounded-lg font-light transition-all duration-300" style={{ color: authView === 'register' ? '#d4c8bc' : '#5e5349', background: authView === 'register' ? 'rgba(192,168,148,0.12)' : 'transparent', border: `1px solid ${authView === 'register' ? 'rgba(192,168,148,0.2)' : 'transparent'}` }}>
              <UserPlus size={12} className="inline mr-1.5" />注册
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-light mb-1.5" style={{ color: '#7d7168' }}>用户名</label>
              <input type="text" value={authUsername} onChange={e => setAuthUsername(e.target.value)} placeholder="2-20 位字符" className="w-full bg-transparent outline-none text-sm font-light px-3 py-2.5 rounded-lg transition-colors duration-300" style={{ color: '#c4b8ac', caretColor: '#c4b8ac', border: '1px solid rgba(255,255,255,0.08)' }} maxLength={20} required />
            </div>
            <div>
              <label className="block text-xs font-light mb-1.5" style={{ color: '#7d7168' }}>
                密码 <span style={{ color: '#5e5349' }}>(可选)</span>
              </label>
              <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder={authView === 'register' ? '留空则无需密码即可登录' : '未设置密码可直接登录'} className="w-full bg-transparent outline-none text-sm font-light px-3 py-2.5 rounded-lg transition-colors duration-300" style={{ color: '#c4b8ac', caretColor: '#c4b8ac', border: '1px solid rgba(255,255,255,0.08)' }} />
            </div>

            {authError && (
              <p className="text-xs font-light" style={{ color: '#c4a882' }}>{authError}</p>
            )}

            <button type="submit" disabled={authLoading || !authUsername.trim()} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-light tracking-wide transition-all duration-500 ease-in-out hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'rgba(192,168,148,0.15)', color: '#d4c8bc', border: '1px solid rgba(192,168,148,0.2)' }}>
              {authLoading ? <Loader2 size={14} className="animate-spin" /> : (authView === 'login' ? <><LogIn size={14} />登录</> : <><UserPlus size={14} />注册</>)}
            </button>
          </form>
        </div>

        <footer className="text-center mt-8 sm:mt-10">
          <p className="text-xs" style={{ color: '#4a4440' }}>crafted with quiet attention</p>
        </footer>
      </div>
    )
  }

  // ─── Detail view ────────────────────────────────────────────────────

  if (activeWork) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(170deg, #1c1a19 0%, #232120 40%, #1e1c1b 100%)' }}>
        <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5">
          <button onClick={() => { setActiveWork(null); setActiveWorkHtml('') }} className="flex items-center gap-2 text-xs font-light transition-colors duration-300" style={{ color: '#8a7e74' }}>
            <ArrowLeft size={14} /><span className="hidden sm:inline">返回展厅</span>
          </button>
          <span className="text-xs font-light truncate max-w-[200px] sm:max-w-none" style={{ color: '#5e5349' }}>{activeWork.title}</span>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={copyHtml} className="transition-colors duration-300 p-1" style={{ color: '#5e5349' }} title="复制 HTML"><Copy size={14} /></button>
            <button onClick={downloadHtml} className="transition-colors duration-300 p-1" style={{ color: '#5e5349' }} title="下载 HTML"><Download size={14} /></button>
            <button onClick={() => { setActiveWork(null); setActiveWorkHtml('') }} className="transition-colors duration-300 p-1" style={{ color: '#5e5349' }}><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 px-4 sm:px-8 pb-4 sm:pb-8">
          <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', minHeight: 'calc(100vh - 120px)' }}>
            {loadingWork ? (
              <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}><Loader2 size={24} className="animate-spin" style={{ color: '#5e5349' }} /></div>
            ) : (
              <iframe srcDoc={activeWorkHtml} title={activeWork.title} sandbox="allow-scripts" className="w-full border-0" style={{ minHeight: 'calc(100vh - 120px)' }} />
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── Main view ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(170deg, #1c1a19 0%, #232120 40%, #1e1c1b 100%)' }}>
      {/* User bar */}
      <div className="flex items-center justify-end px-4 sm:px-8 pt-4 sm:pt-5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-light" style={{ color: '#5e5349' }}>{user.username}</span>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-light transition-colors duration-300" style={{ color: '#5e5349' }} title="退出登录">
            <LogOut size={12} /><span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </div>

      <header className="pt-8 sm:pt-10 pb-6 sm:pb-8 px-4 sm:px-6 text-center">
        <p className="text-xs tracking-widest uppercase mb-3 sm:mb-4" style={{ color: '#8a7e74', letterSpacing: '0.25em' }}>vibe creator engine</p>
        <h1 className="text-2xl sm:text-3xl font-extralight mb-2 sm:mb-3" style={{ color: '#d4c8bc' }}>自循环创意工作流引擎</h1>
        <p className="text-xs sm:text-sm font-light" style={{ color: '#7d7168' }}>输入一个创意种子，让引擎自动生成、审查、修正，直到产出治愈心灵的作品。</p>
      </header>

      {/* Input Area */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 mb-8 sm:mb-10">
        <div className="flex items-center gap-2 sm:gap-3 rounded-2xl px-4 sm:px-5 py-3 sm:py-4 transition-shadow duration-500" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
          <div className="flex-1 flex flex-col">
            <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleGenerate()} placeholder="输入你的创意种子..." className="bg-transparent outline-none text-xs sm:text-sm font-light" style={{ color: '#c4b8ac', caretColor: '#c4b8ac' }} disabled={generating} maxLength={500} />
            {seed.length > 0 && (
              <span className="text-xs mt-1 self-end" style={{ color: seed.length > 450 ? '#c4a882' : '#5e5349' }}>{seed.length}/500</span>
            )}
          </div>
          {generating ? (
            <button onClick={handleAbort} className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-light tracking-wide transition-all duration-300 hover:scale-[1.02]" style={{ background: 'rgba(192,100,100,0.15)', color: '#c4a882', border: '1px solid rgba(192,100,100,0.2)' }}>
              <Square size={12} />中止
            </button>
          ) : (
            <button onClick={() => handleGenerate()} disabled={!seed.trim()} className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-light tracking-wide transition-all duration-500 ease-in-out hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'rgba(192,168,148,0.15)', color: '#d4c8bc', border: '1px solid rgba(192,168,148,0.2)' }}>
              <Sparkles size={14} />开始生成
            </button>
          )}
        </div>
      </div>

      {/* Live Logs */}
      {logs.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 mb-6 sm:mb-8">
          <div className="rounded-2xl px-4 sm:px-6 py-4 sm:py-5 space-y-2.5 max-h-60 overflow-y-auto" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
            {generating && currentIteration > 0 && (
              <div className="flex items-center gap-2 text-xs font-light breathing" style={{ color: '#8a7e74' }}>
                <span>第 {currentIteration}/3 轮</span>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex items-center gap-2 sm:gap-3 text-xs font-light ${generating && i === logs.length - 1 ? 'breathing' : ''}`} style={{ color: log.score !== null ? (log.score >= 90 ? '#a8b89a' : '#c4b08a') : '#8a9e94', opacity: i === logs.length - 1 ? 1 : 0.7, animation: i === logs.length - 1 ? 'fadeInLog 0.6s ease-in-out' : 'none' }}>
                <span style={{ color: '#5e5349', minWidth: 56 }}>[{log.role}]</span>
                {log.score !== null && <span style={{ color: log.score >= 90 ? '#a8b89a' : '#c4b08a', minWidth: 48 }}>{log.score}/100</span>}
                <span>{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />

            {hasError && !generating && lastSeed && (
              <div className="pt-2">
                <button onClick={() => handleGenerate(lastSeed)} className="flex items-center gap-2 text-xs font-light px-4 py-2 rounded-lg transition-all duration-300 hover:scale-[1.02]" style={{ color: '#c4b8ac', background: 'rgba(192,168,148,0.1)', border: '1px solid rgba(192,168,148,0.15)' }}>
                  <RotateCcw size={12} />重新生成
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery */}
      <div ref={previewRef} className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 sm:pb-20">
        <div className="flex items-center justify-center gap-3 mb-6 sm:mb-8">
          <p className="text-xs tracking-widest uppercase" style={{ color: '#5e5349', letterSpacing: '0.2em' }}>作品展厅</p>
          <button onClick={loadWorks} className="transition-colors duration-300" style={{ color: '#5e5349' }} title="刷新"><RefreshCw size={12} /></button>
        </div>

        {/* Filter tabs */}
        {works.length > 0 && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {[{ key: 'all', label: '全部' }, { key: 'passed', label: '已通过' }, { key: 'drafts', label: '草稿' }].map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className="text-xs px-3 py-1 rounded-lg font-light transition-all duration-300" style={{ color: filter === f.key ? '#d4c8bc' : '#5e5349', background: filter === f.key ? 'rgba(192,168,148,0.12)' : 'transparent', border: `1px solid ${filter === f.key ? 'rgba(192,168,148,0.2)' : 'transparent'}` }}>
                {f.label}
              </button>
            ))}
          </div>
        )}

        {filteredWorks.length === 0 ? (
          <p className="text-center text-xs font-light" style={{ color: '#4a4440' }}>{works.length === 0 ? '尚无作品，输入创意种子开始生成' : '没有匹配的作品'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {filteredWorks.map((work) => (
              <div key={work.id} onClick={() => { setActiveWork(work); loadWorkContent(work.filename) }} className="group rounded-2xl p-5 sm:p-6 cursor-pointer transition-all duration-500 ease-in-out hover:translate-y-[-2px] relative" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <button onClick={(e) => deleteWork(work.filename, e)} className="absolute top-3 sm:top-4 right-3 sm:right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ color: '#5e5349' }}><Trash2 size={12} /></button>

                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mb-3 sm:mb-4" style={{ background: 'rgba(192,168,148,0.1)', color: '#b8a99a' }}><Sparkles size={18} /></div>
                <h3 className="text-sm font-light mb-1.5" style={{ color: '#d4c8bc' }}>{work.title}</h3>
                {work.seed && <p className="text-xs font-light mb-2 truncate" style={{ color: '#5e5349' }}>"{work.seed}"</p>}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-light" style={{ color: '#7d7168' }}>{formatDate(work.createdAt)}</p>
                  <div className="flex items-center gap-1.5">
                    {work.iterations && <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(168,184,154,0.1)', color: '#8a9e82' }}>{work.iterations}轮</span>}
                    {work.score != null && work.score < 90 && <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(192,130,100,0.1)', color: '#c4a882' }}>{work.score}分</span>}
                    {work.score != null && work.score >= 90 && <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(168,184,154,0.1)', color: '#8a9e82' }}>通过</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="text-center pb-8 sm:pb-12">
        <p className="text-xs" style={{ color: '#4a4440' }}>crafted with quiet attention</p>
      </footer>
    </div>
  )
}

export default App
