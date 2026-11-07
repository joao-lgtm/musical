import type { CSSProperties } from 'react'
import type { EngineState } from '../audio/types'
import { useEngine } from '../hooks/useEngine'
import { PlayIcon } from './Icons'
import { DEMO_PRESET, toPattern } from './drumPresets'

export function StartScreen({ state }: { state: EngineState }) {
  const engine = useEngine()
  const busy = state.status === 'initializing'
  const failed = state.status === 'error'

  async function start() {
    try {
      await engine.init()
      const current = engine.getState()
      // Só oferece a batida inicial em uma mesa vazia; projetos abertos são preservados.
      if (current.tracks.every((t) => t.status === 'empty') && !current.pattern.some((row) => row.some(Boolean))) {
        engine.setPattern(toPattern(DEMO_PRESET))
        engine.setTrack(current.tracks.length - 1, { volume: 0.6 })
      }
      engine.play()
    } catch { /* status error apresenta a falha de áudio */ }
  }

  return (
    <main className="start">
      <div className="start__panel">
        <div className="start__bars" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} style={{ '--ch': `var(--ch${i})`, '--d': `${i * 140}ms` } as CSSProperties} />
          ))}
        </div>
        <h1 className="start__title">Loop Studio</h1>
        <p className="start__lede">
          Monte uma música em camadas: a batida já está pronta, você grava o resto por cima.
        </p>
        {/* a rejeição já vira state.error; o catch só evita erro não tratado */}
        <button className="btn btn--primary start__go" onClick={start} disabled={busy}>
          <PlayIcon size={20} />
          {busy ? 'Preparando o áudio…' : failed ? 'Tentar de novo' : 'Começar a tocar'}
        </button>
        <p className="start__hint">O microfone só é pedido quando você for gravar. O áudio nunca sai deste navegador.</p>
        {failed && (
          <div className="start__error" role="alert">Não conseguimos iniciar o áudio. Toque em Tentar de novo.</div>
        )}
      </div>
    </main>
  )
}
