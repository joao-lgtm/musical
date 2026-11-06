import { useEffect, useRef, useState } from 'react'
import { Calibration } from './components/Calibration'
import { CountIn } from './components/CountIn'
import { GuideBar, SurpriseButton } from './components/GuideBar'
import { Mixer } from './components/Mixer'
import { Performance } from './components/Performance'
import { ProjectBar } from './components/ProjectBar'
import { Sequencer } from './components/Sequencer'
import { Shortcuts } from './components/Shortcuts'
import { StartScreen } from './components/StartScreen'
import { Transport } from './components/Transport'
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
              <strong>{state.status === 'initializing' ? 'Reconectando o microfone…' : 'O microfone parou de responder.'}</strong>
              {state.error && <span> {state.error}</span>}
            </p>
            {state.status === 'error' && (
              <button className="btn btn--sm" onClick={() => engine.init().catch(() => {})}>Reconectar</button>
            )}
          </div>
        )}

        <Transport state={state} />
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
