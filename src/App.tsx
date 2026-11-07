import { useEffect, useRef, useState } from 'react'
import { Calibration } from './components/Calibration'
import { CountIn } from './components/CountIn'
import { GuideBar, SurpriseButton } from './components/GuideBar'
import { Mixer } from './components/Mixer'
import { lastOcarina, rememberOcarina } from './components/NotePads'
import { Performance } from './components/Performance'
import { ProjectBar } from './components/ProjectBar'
import { Sequencer } from './components/Sequencer'
import { Shortcuts } from './components/Shortcuts'
import { StartScreen } from './components/StartScreen'
import { Transport } from './components/Transport'
import { useAutosave } from './hooks/useAutosave'
import { EngineContext, useEngineState, useOwnEngine } from './hooks/useEngine'

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const INTERACTIVE = `button, summary, a[href], [role=button], [role=slider], ${FIELD}`
const focusIn = (t: EventTarget | null, sel: string) => t instanceof Element && t.closest(sel) !== null

const MODE_KEY = 'loopstudio.mode'
const loadStudio = () => {
  try {
    return localStorage.getItem(MODE_KEY) === 'studio'
  } catch {
    return false
  }
}

export default function App() {
  const engine = useOwnEngine()
  const state = useEngineState(engine)
  // depois de pronto uma vez, erros (ex.: mic desconectado) aparecem na mesa, não na tela inicial
  const [started, setStarted] = useState(false)
  if (state.status === 'ready' && !started) setStarted(true)
  useAutosave(engine, started && state.status === 'ready')
  const ready = state.status === 'ready'
  const [studio, setStudio] = useState(loadStudio)
  const keysRef = useRef<HTMLDialogElement>(null)
  const calRef = useRef<HTMLDialogElement>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [perf, setPerf] = useState(false)

  function enterPerf() {
    setPerf(true)
    // tela cheia quando o navegador deixa; sem ela o overlay cobre a janela
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  function exitPerf() {
    setPerf(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  // saiu da tela cheia pelo navegador (Esc) → sai do modo performance
  useEffect(() => {
    const onFs = () => !document.fullscreenElement && setPerf(false)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  const micCount = state.tracks.length - 1

  function chooseMode(on: boolean) {
    setStudio(on)
    try {
      localStorage.setItem(MODE_KEY, on ? 'studio' : 'simple')
    } catch {
      /* modo privado: só não persiste */
    }
  }

  useEffect(() => {
    if (!ready || calibrating) return
    const held = new Map<string, { track: number; degree: number }>()
    const showHeld = (track: number, degree: number, on: boolean) => {
      const pad = document.querySelector<HTMLElement>(`.note-pads[data-track="${track}"] [data-degree="${degree}"]`)
      if (on) pad?.setAttribute('data-key-playing', '')
      else pad?.removeAttribute('data-key-playing')
    }
    const release = () => {
      for (const { track, degree } of held.values()) {
        engine.noteOff(track, degree)
        showHeld(track, degree, false)
      }
      held.clear()
    }
    const down = (e: KeyboardEvent) => {
      const degree = 'asdfghjk'.indexOf(e.key.toLowerCase())
      if (degree < 0 || e.repeat || held.has(e.code) || e.ctrlKey || e.metaKey || e.altKey ||
          focusIn(e.target, FIELD) || document.querySelector('dialog[open]')) return
      const tracks = engine.getState().tracks
      const active = tracks.findIndex((t) => t.source === 'ocarina' && (t.status === 'armed' || t.status === 'recording'))
      const last = lastOcarina(engine)
      const track = active >= 0 ? active : last !== undefined && tracks[last]?.source === 'ocarina'
        ? last : tracks.findIndex((t) => t.source === 'ocarina')
      if (track < 0) return
      e.preventDefault()
      held.set(e.code, { track, degree })
      rememberOcarina(engine, track)
      showHeld(track, degree, true)
      engine.noteOn(track, degree)
    }
    const up = (e: KeyboardEvent) => {
      const note = held.get(e.code)
      if (!note) return
      engine.noteOff(note.track, note.degree)
      showHeld(note.track, note.degree, false)
      held.delete(e.code)
    }
    const visibility = () => { if (document.hidden) release() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      release()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [engine, ready, calibrating])

  // Espaço = tocar/parar, 1–8 = gravar, P = performance, ? = atalhos (Q W E R ficam com o Sequencer)
  useEffect(() => {
    if (!ready || calibrating) return
    const down = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (e.ctrlKey || e.metaKey || e.altKey || focusIn(e.target, FIELD)) return
      if (e.key === 'Escape' && perf) {
        exitPerf()
      } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
        if (perf) exitPerf()
        else enterPerf()
      } else if (e.key === '?') {
        e.preventDefault()
        keysRef.current?.showModal()
      } else if (e.code === 'Space') {
        // em controles focados o Espaço os ativa normalmente
        if (focusIn(e.target, INTERACTIVE)) return
        e.preventDefault()
        if (e.repeat) return
        if (engine.getState().playing) engine.stop()
        else engine.play()
      } else if (!e.repeat && /^[1-9]$/.test(e.key) && Number(e.key) <= micCount) {
        engine.record(Number(e.key) - 1)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [engine, ready, micCount, calibrating, perf])

  if (!started)
    return (
      <EngineContext value={engine}>
        <StartScreen state={state} />
      </EngineContext>
    )

  return (
    <EngineContext value={engine}>
      <main className="desk" data-studio={studio || undefined} inert={perf}>
        <header className="desk__top">
          <h1 className="brand">
            <span className="brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
            Loop Studio
          </h1>
          <div className="desk__tools">
            <div className="seg seg--view" role="group" aria-label="Modo da mesa">
              <button className="seg__btn" aria-pressed={!studio} onClick={() => chooseMode(false)}>Simples</button>
              <button className="seg__btn" aria-pressed={studio} onClick={() => chooseMode(true)}>Estúdio</button>
            </div>
            <button className="btn btn--sm btn--perf" onClick={enterPerf} aria-keyshortcuts="P">
              Performance <kbd>P</kbd>
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => keysRef.current?.showModal()} aria-keyshortcuts="?">
              Atalhos <kbd>?</kbd>
            </button>
          </div>
        </header>

        {state.status !== 'ready' && (
          <div className="alert" role="alert">
            <p>
              <strong>{state.status === 'initializing' ? 'Preparando o áudio…' : 'O áudio parou de responder.'}</strong>
              {state.error && <span> {state.error}</span>}
            </p>
            {state.status === 'error' && (
              <button className="btn btn--sm" onClick={() => engine.init().catch(() => {})}>Tentar de novo</button>
            )}
          </div>
        )}

        <Transport state={state} studio={studio} />
        <ProjectBar />
        <div className="cue">
          <GuideBar state={state} onCalibrate={() => calRef.current?.showModal()} />
          <SurpriseButton />
        </div>
        <Mixer state={state} studio={studio} />
        <Sequencer />

        <details className="adv">
          <summary>Avançado</summary>
          <label className="adv__row">
            <span>Compensação de latência</span>
            <input
              type="range"
              min={-200}
              max={200}
              step={5}
              value={state.latencyOffset}
              onChange={(e) => engine.setLatencyOffset(Number(e.target.value))}
              aria-describedby="lat-help"
            />
            <output className="adv__val">{state.latencyOffset > 0 ? '+' : ''}{state.latencyOffset} ms</output>
          </label>
          <button className="btn btn--sm adv__cal" onClick={() => calRef.current?.showModal()}>
            Calibrar com palmas
          </button>
          <p className="adv__help" id="lat-help">
            Se as gravações ficam atrasadas em relação ao metrônomo, aumente o valor (positivo puxa a gravação para mais cedo). Vale para as próximas gravações.
          </p>
        </details>
      </main>
      {perf && <Performance state={state} onExit={exitPerf} />}
      <CountIn />
      <Shortcuts ref={keysRef} />
      <Calibration ref={calRef} onBusy={setCalibrating} />
    </EngineContext>
  )
}
