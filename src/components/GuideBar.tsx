import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

// Onboarding sem modal; avisos de take silencioso continuam após 3 camadas
export function GuideBar({ state, onCalibrate }: { state: EngineState; onCalibrate: () => void }) {
  // a calibração é oferecida uma vez, logo após o 1º take
  const engine = useEngine()
  const guide = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef({ wasInside: false, target: 0 })
  const lastPreset = useRef<string | undefined>(undefined)
  const [offered, setOffered] = useState(calOffered)
  const mics = state.tracks.slice(0, -1)
  const layers = mics.filter((t) => t.status === 'recorded').length
  const recording = mics.findIndex((t) => t.status === 'recording')
  const armed = mics.findIndex((t) => t.status === 'armed')
  const silent = mics.findIndex((t) => t.silentTake === true)
  const free = mics.findIndex((t) => t.status === 'empty') + 1

  let msg: ReactNode = null
  let touchMsg: ReactNode = null
  let label = ''
  let action = () => {}
  const active = recording >= 0 ? recording : armed
  const silentWarning = silent >= 0 && active < 0
  if (active >= 0) {
    msg = recording >= 0
      ? <>Gravando a faixa {active + 1}. O loop fecha sozinho no fim.</>
      : <>Faixa {active + 1} armada: a gravação começa no tempo 1.</>
    label = 'Cancelar'
    action = () => engine.record(active)
  } else if (silentWarning) {
    msg = <>Não ouvimos nada na faixa {silent + 1}. Confira se o microfone está ligado e perto de você.</>
    label = 'Gravar de novo'
    action = () => engine.record(silent)
  } else if (layers === 0) {
    msg = <>Aperte <kbd>1</kbd> e cante, bata palmas ou bata na mesa.</>
    touchMsg = <>Toque em Gravar e cante, bata palmas ou bata na mesa.</>
    label = 'Gravar faixa 1'
    action = () => engine.record(0)
  } else if (layers === 1 && free) {
    msg = <>Boa! Agora outra camada por cima: aperte <kbd>{free}</kbd>.</>
    touchMsg = <>Boa! Toque em Gravar para adicionar outra camada por cima.</>
    label = `Gravar faixa ${free}`
    action = () => engine.record(free - 1)
  } else if (layers === 2) {
    msg = <>Solte a bateria: toque os pads <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> ou peça um “Surpreenda-me”.</>
    touchMsg = <>Solte a bateria: toque em Surpreenda-me para criar um ritmo.</>
    label = 'Surpreenda-me'
    action = () => { lastPreset.current = surprise(engine, lastPreset.current) }
  }

  // Antes da mudança, registra a origem; após o commit, só recupera foco perdido.
  useLayoutEffect(() => {
    const el = guide.current
    return () => {
      const tracks = engine.getState().tracks.slice(0, -1)
      const current = tracks.findIndex((t) => t.status === 'armed' || t.status === 'recording')
      pendingFocus.current = {
        wasInside: !!el?.contains(document.activeElement),
        target: current >= 0 ? current : active >= 0 ? active : silentWarning ? silent : Math.max(0, free - 1),
      }
    }
  })
  useLayoutEffect(() => {
    const { wasInside, target } = pendingFocus.current
    pendingFocus.current.wasInside = false
    const focused = document.activeElement
    if (wasInside && (!focused || focused === document.body || !focused.isConnected)) {
      document.querySelector<HTMLButtonElement>(`.strip[aria-labelledby="ch${target + 1}-name"] .rec`)?.focus()
    }
  })

  if (!msg) return null
  const offerCal = !silentWarning && layers === 1 && recording < 0 && armed < 0 && !offered
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
    <div ref={guide} className={silentWarning ? 'guide guide--warning' : 'guide'}>
      <span className="guide__dot" aria-hidden="true" />
      <p role="status">
        {touchMsg ? <><span className="guide__desktop">{msg}</span><span className="guide__touch">{touchMsg}</span></> : msg}
      </p>
      <button type="button" className="btn guide__action" onClick={action} disabled={state.status !== 'ready'}>
        {label}
      </button>
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
