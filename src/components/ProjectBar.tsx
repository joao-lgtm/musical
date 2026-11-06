import { useEffect, useRef, useState } from 'react'
import { audioBufferToWav } from '../audio/wav'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { deleteProject, listProjects, loadProject, saveProject } from '../storage/projects'
import s from './ProjectBar.module.css'

type Entry = Awaited<ReturnType<typeof listProjects>>[number]
type Busy = 'save' | 'load' | 'wav' | null

const MIME = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ProjectBar() {
  const engine = useEngine()
  const state = useEngineState(engine)
  const ready = state.status === 'ready'

  const [name, setName] = useState('Meu loop')
  const [id, setId] = useState<Entry['id'] | undefined>()
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [loops, setLoops] = useState(2)
  const [projects, setProjects] = useState<Entry[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [recSec, setRecSec] = useState<number | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const dialog = useRef<HTMLDialogElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)

  // Ao desmontar, encerra a gravação (o onstop libera as tracks)
  useEffect(() => () => recorder.current?.stop(), [])

  // Uma ação por vez; erros viram mensagem inline
  const run = async (kind: Exclude<Busy, null>, fail: string, fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    setNote('')
    try {
      await fn()
    } catch (e) {
      setError(`${fail}: ${msg(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', 'Não foi possível salvar', async () => {
      const title = name.trim() || 'Sem nome'
      setId(await saveProject(title, engine.exportProject(), id))
      setName(title)
      setNote('Projeto salvo')
    })

  const refresh = async () => setProjects(await listProjects())

  const openList = () => {
    setConfirmId(null)
    setProjects(null)
    dialog.current?.showModal()
    setListOpen(true)
    refresh().catch((e) => {
      setProjects([])
      setError(`Não foi possível listar os projetos: ${msg(e)}`)
    })
  }

  const open = (p: Entry) =>
    run('load', 'Não foi possível abrir', async () => {
      const data = await loadProject(p.id)
      if (!data) throw new Error(`"${p.name}" não existe mais`)
      engine.importProject(data)
      setId(p.id)
      setName(p.name)
      dialog.current?.close()
      setNote(`"${p.name}" carregado`)
    })

  const remove = async (p: Entry) => {
    if (confirmId !== p.id) return setConfirmId(p.id)
    try {
      await deleteProject(p.id)
      if (p.id === id) setId(undefined)
      setConfirmId(null)
      setError(null)
      await refresh()
    } catch (e) {
      setError(`Não foi possível apagar: ${msg(e)}`)
    }
  }

  const exportWav = () =>
    run('wav', 'Não foi possível exportar o WAV', async () => {
      const buf = await engine.renderMix(loops)
      download(audioBufferToWav(buf), `loop-studio-${state.bpm}bpm.wav`)
      setNote('WAV exportado')
    })

  const startVideo = async () => {
    setError(null)
    setNote('')
    const audio = engine.getOutputStream()?.getAudioTracks().map((t) => t.clone()) ?? []
    let screen: MediaStream
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions)
    } catch (e) {
      audio.forEach((t) => t.stop())
      // NotAllowedError = o usuário cancelou o seletor; não é erro
      if (!(e instanceof DOMException && e.name === 'NotAllowedError')) setError(`Não foi possível capturar a tela: ${msg(e)}`)
      return
    }
    const stream = new MediaStream([...screen.getVideoTracks(), ...audio])
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    const chunks: Blob[] = []
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      setError(`Gravação de vídeo não suportada neste navegador: ${msg(e)}`)
      return
    }
    const started = Date.now()
    const tick = setInterval(() => setRecSec(Math.floor((Date.now() - started) / 1000)), 250)
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      clearInterval(tick)
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      setRecSec(null)
      const type = rec.mimeType || mimeType || 'video/webm'
      if (chunks.length) download(new Blob(chunks, { type }), `loop-studio-${state.bpm}bpm.${type.includes('mp4') ? 'mp4' : 'webm'}`)
    }
    // Usuário clicou em "Parar compartilhamento" no navegador
    screen.getVideoTracks()[0]?.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop() })
    recorder.current = rec
    rec.start(1000)
    setRecSec(0)
  }

  const recording = recSec !== null
  const off = !ready || busy !== null
  // Com o diálogo aberto o aviso aparece dentro dele, senão ficaria escondido atrás
  const notice = error && (
    <p className={s.error} role="alert">
      <span>{error}</span>
      <button type="button" className={s.dismiss} onClick={() => setError(null)} aria-label="Fechar aviso">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </p>
  )

  return (
    <div className={s.bar}>
      <form className={s.group} onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className={s.name}>
          <span className={s.label}>Projeto</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} spellCheck={false} />
        </label>
        <button type="submit" className={s.btn} disabled={off}>
          {busy === 'save' ? 'Salvando…' : id ? 'Salvar' : 'Salvar novo'}
        </button>
        <button type="button" className={s.btn} onClick={openList} disabled={off}>Projetos</button>
      </form>

      <div className={s.group}>
        <label className={s.loops}>
          <span className={s.label}>Repetições</span>
          <select value={loops} onChange={(e) => setLoops(Number(e.target.value))} disabled={off}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
        <button type="button" className={s.btn} onClick={exportWav} disabled={off} aria-busy={busy === 'wav'}>
          {busy === 'wav' ? <><span className={s.spin} aria-hidden="true" />Renderizando…</> : 'Exportar WAV'}
        </button>
      </div>

      <div className={s.group}>
        {recording ? (
          <button type="button" className={`${s.btn} ${s.rec}`} onClick={() => recorder.current?.stop()}>
            <span className={s.recDot} aria-hidden="true" />
            <span>REC <time className={s.time}>{clock(recSec)}</time></span>
            <span className={s.recStop}>Parar</span>
          </button>
        ) : (
          <button type="button" className={s.btn} onClick={startVideo} disabled={!ready}>
            <span className={s.recIdle} aria-hidden="true" />
            Gravar vídeo
          </button>
        )}
      </div>

      <p className={s.note} role="status">{note}</p>
      {!listOpen && notice}

      <dialog ref={dialog} className={s.dialog} aria-labelledby="projects-title" onClose={() => setListOpen(false)} onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}>
        <div className={s.dialogBody}>
          <header className={s.dialogHead}>
            <h2 id="projects-title">Projetos salvos</h2>
            <button type="button" className={s.btn} onClick={() => dialog.current?.close()}>Fechar</button>
          </header>
          {notice}
          {projects === null ? (
            <p className={s.empty}>Carregando…</p>
          ) : projects.length === 0 ? (
            <p className={s.empty}>Nenhum projeto salvo ainda. Grave um loop e clique em Salvar.</p>
          ) : (
            <ul className={s.list}>
              {projects.map((p) => (
                <li key={p.id} className={s.item} data-current={p.id === id || undefined}>
                  <span className={s.itemName}>{p.name}</span>
                  <span className={s.itemDate}>{when.format(p.updatedAt)}</span>
                  <button type="button" className={s.btn} onClick={() => open(p)} disabled={off}>Abrir</button>
                  <button
                    type="button"
                    className={`${s.btn} ${confirmId === p.id ? s.danger : ''}`}
                    onClick={() => remove(p)}
                    onBlur={() => setConfirmId((c) => (c === p.id ? null : c))}
                    aria-label={confirmId === p.id ? `Confirmar: apagar ${p.name}` : `Apagar ${p.name}`}
                  >
                    {confirmId === p.id ? 'Confirmar' : 'Apagar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </div>
  )
}
