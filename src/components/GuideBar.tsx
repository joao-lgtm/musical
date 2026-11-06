import type { ReactNode } from 'react'
import type { EngineState } from '../audio/types'

// Onboarding sem modal: uma frase derivada do estado das faixas; some após 3 camadas
export function GuideBar({ state }: { state: EngineState }) {
  const mics = state.tracks.slice(0, -1)
  const layers = mics.filter((t) => t.status === 'recorded').length
  const recording = mics.findIndex((t) => t.status === 'recording')
  const armed = mics.findIndex((t) => t.status === 'armed')
  const free = mics.findIndex((t) => t.status === 'empty') + 1

  let msg: ReactNode = null
  if (recording >= 0) msg = <>Gravando a faixa {recording + 1}. O loop fecha sozinho no fim.</>
  else if (armed >= 0) msg = <>Faixa {armed + 1} armada: a gravação começa no tempo 1.</>
  else if (layers === 0) msg = <>Aperte <kbd>1</kbd> e cante, bata palmas ou bata na mesa.</>
  else if (layers === 1 && free) msg = <>Boa! Agora outra camada por cima: aperte <kbd>{free}</kbd>.</>
  else if (layers === 2) msg = <>Solte a bateria: toque os pads <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> ou peça um “Surpreenda-me”.</>

  if (!msg || layers >= 3) return null
  return (
    <p className="guide" role="status">
      <span className="guide__dot" aria-hidden="true" />
      {msg}
    </p>
  )
}
