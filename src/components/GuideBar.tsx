import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { surprise } from './drumPresets'
import { DiceIcon } from './Icons'
import type { EngineState } from '../audio/types'

const CAL_KEY = 'loopstudio.calOffered'
const calOffered = () => {
  try {
    return localStorage.getItem(CAL_KEY) === '1'
  } catch {
    return false
  }
}

// Onboarding sem modal: uma frase derivada do estado das faixas; some após 3 camadas
export function GuideBar({ state, onCalibrate }: { state: EngineState; onCalibrate: () => void }) {
  // a calibração é oferecida uma vez, logo após o 1º take
  const [offered, setOffered] = useState(calOffered)
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
  const offerCal = layers === 1 && recording < 0 && armed < 0 && !offered
  function calibrate() {
    setOffered(true)
    try {
      localStorage.setItem(CAL_KEY, '1')
    } catch {
      /* sem persistência */
    }
    onCalibrate()
  }
  return (
    <div className="guide">
      <span className="guide__dot" aria-hidden="true" />
      <p role="status">{msg}</p>
      {offerCal && (
        <button className="guide__cal" onClick={calibrate}>
          Ficou desalinhado? Calibrar em 10 s
        </button>
      )}
    </div>
  )
}

// Atalho compacto para o "Surpreenda-me" perto do topo (no celular o Sequencer fica no fim da página)
export function SurpriseButton() {
  const engine = useEngine()
  const ready = useEngineState(engine).status === 'ready'
  const last = useRef<string | undefined>(undefined)
  const [picked, setPicked] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function go() {
    last.current = surprise(engine, last.current)
    setPicked(last.current)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPicked(null), 2000)
  }

  return (
    <button className="btn btn--sm cue__surprise" onClick={go} disabled={!ready}>
      <DiceIcon size={16} />
      <span aria-live="polite">{picked ? `Bateria: ${picked}` : 'Surpreenda-me'}</span>
    </button>
  )
}
