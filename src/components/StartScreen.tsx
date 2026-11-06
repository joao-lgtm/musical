import type { CSSProperties } from 'react'
import type { EngineState } from '../audio/types'
import { useEngine } from '../hooks/useEngine'
import { MicIcon } from './Icons'

export function StartScreen({ state }: { state: EngineState }) {
  const engine = useEngine()
  const busy = state.status === 'initializing'
  const failed = state.status === 'error'

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
          Quatro faixas, um microfone. Bata na mesa, bata palmas, cante: cada gravação vira um loop que toca junto com as outras.
        </p>
        {/* a rejeição já vira state.error; o catch só evita erro não tratado */}
        <button className="btn btn--primary start__go" onClick={() => engine.init().catch(() => {})} disabled={busy}>
          <MicIcon size={20} />
          {busy ? 'Pedindo o microfone…' : failed ? 'Tentar de novo' : 'Começar'}
        </button>
        {failed ? (
          <div className="start__error" role="alert">
            <strong>Não conseguimos usar o microfone.</strong>
            {state.error && <span> {state.error}</span>}
            <p>
              Clique no ícone de cadeado ao lado do endereço do site, permita o microfone e tente de novo. Confira também se ele está
              conectado e livre de outros apps.
            </p>
          </div>
        ) : (
          <p className="start__hint">O navegador vai pedir acesso ao microfone. O áudio fica só neste navegador.</p>
        )}
      </div>
    </main>
  )
}
