import { useEffect, useState } from 'react'
import { Channel } from './components/Channel'
import { StartScreen } from './components/StartScreen'
import { Transport } from './components/Transport'
import { EngineContext, TRACKS, useEngineState, useOwnEngine } from './hooks/useEngine'

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const INTERACTIVE = `button, summary, a[href], [role=button], [role=slider], ${FIELD}`
const focusIn = (t: EventTarget | null, sel: string) => t instanceof Element && t.closest(sel) !== null

export default function App() {
  const engine = useOwnEngine()
  const state = useEngineState(engine)
  // depois de pronto uma vez, erros (ex.: mic desconectado) aparecem na mesa, não na tela inicial
  const [started, setStarted] = useState(false)
  if (state.status === 'ready' && !started) setStarted(true)
  const ready = state.status === 'ready'

  // Espaço = tocar/parar, 1–4 = gravar faixa
  useEffect(() => {
    if (!ready) return
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || focusIn(e.target, FIELD)) return
      // Espaço só controla o transporte com foco em área neutra; em controles ele os ativa
      if (e.code === 'Space') {
        if (focusIn(e.target, INTERACTIVE)) return
        e.preventDefault()
        if (e.repeat) return
        if (engine.getState().playing) engine.stop()
        else engine.play()
      } else if (!e.repeat && /^[1-9]$/.test(e.key) && Number(e.key) <= TRACKS) {
        engine.record(Number(e.key) - 1)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [engine, ready])

  if (!started) return <EngineContext value={engine}><StartScreen state={state} /></EngineContext>

  return (
    <EngineContext value={engine}>
    <main className="desk">
      <header className="desk__top">
        <h1 className="brand">
          <span className="brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
          Loop Studio
        </h1>
        <p className="desk__keys">
          <kbd>Espaço</kbd> tocar/parar <span aria-hidden="true">·</span> <kbd>1</kbd>–<kbd>4</kbd> gravar
        </p>
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

      <div className="channels">
        {state.tracks.map((t, i) => (
          <Channel key={i} index={i} track={t} transportPlaying={state.playing} />
        ))}
      </div>

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
        <p className="adv__help" id="lat-help">
          Se as gravações ficam atrasadas em relação ao metrônomo, aumente o valor (positivo puxa a gravação para mais cedo). Vale para as próximas gravações.
        </p>
      </details>
    </main>
    </EngineContext>
  )
}
