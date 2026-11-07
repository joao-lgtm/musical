import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { surprise } from './drumPresets'
import { DiceIcon } from './Icons'
import type { EngineState } from '../audio/types'

const MIC_TIP_KEY = 'loopstudio.micTipShown'
const micTipShown = () => {
  try { return localStorage.getItem(MIC_TIP_KEY) === '1' } catch { return false }
}

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
  const tipEligible = useRef(!micTipShown())
  const tipActive = useRef(false)
  const [showTip, setShowTip] = useState(false)
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
  const micUnavailable = (state.mic === 'denied' || state.mic === 'missing') && active < 0 && state.micTrack === null
  useEffect(() => {
    if (state.mic === 'ready' && tipEligible.current) {
      tipEligible.current = false
      setShowTip(true)
    }
    if (active >= 0) tipActive.current = true
    else if (tipActive.current) setShowTip(false)
  }, [state.mic, active])

  if (silentWarning) {
    msg = <>Não ouvimos nada na faixa {silent + 1}. Confira se o microfone está ligado e perto de você.</>
    label = 'Gravar de novo'
    action = () => engine.record(silent)
  } else if (micUnavailable) {
    msg = state.mic === 'denied'
      ? <>Microfone bloqueado. Libere no cadeado ao lado do endereço.</>
      : <>Microfone desconectado ou indisponível.</>
    label = 'Tentar de novo'
    action = () => { void engine.ensureMic() }
  } else if (state.mic === 'requesting') {
    msg = <>Permita o microfone na janela do navegador.</>
  } else if (active >= 0) {
    msg = recording >= 0
      ? <>Gravando a faixa {active + 1}. O loop fecha sozinho no fim.</>
      : <>Faixa {active + 1} armada: a gravação começa no tempo 1.</>
    label = 'Cancelar'
    action = () => engine.record(active)
  } else if (layers === 0) {
    msg = <>A batida está rolando. Aperte <kbd>1</kbd> e cante, bata palmas ou bata na mesa.</>
    touchMsg = <>A batida está rolando. Toque em Gravar na faixa 1 e cante, bata palmas ou bata na mesa.</>
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
  const offerCal = !micUnavailable && state.mic !== 'requesting' && !silentWarning && layers === 1 && recording < 0 && armed < 0 && !offered
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
    <div ref={guide} className={silentWarning || micUnavailable ? 'guide guide--warning' : 'guide'}>
      <span className="guide__dot" aria-hidden="true" />
      <p role="status">
        {touchMsg ? <><span className="guide__desktop">{msg}</span><span className="guide__touch">{touchMsg}</span></> : msg}
      </p>
      {label && <button type="button" className="btn guide__action" onClick={action} disabled={state.status !== 'ready'}>
        {label}
      </button>}
      {showTip && state.mic === 'ready' && active >= 0 && !silentWarning && (
        <InputTip />
      )}
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

function InputTip() {
  const engine = useEngine()
  const bar = useRef<HTMLSpanElement>(null)
  const [inputStatus, setInputStatus] = useState('Testando o microfone…')
  useEffect(() => {
    try { localStorage.setItem(MIC_TIP_KEY, '1') } catch { /* sem persistência */ }
    let heard = false
    let frame = 0
    let lowSince: number | null = null
    function update(now: number) {
      const level = Math.max(0, Math.min(1, engine.getInputLevel()))
      if (bar.current) bar.current.style.transform = `scaleX(${level})`
      if (level > 0.05) heard = true
      if (level < 0.05) lowSince ??= now
      else lowSince = null
      setInputStatus(lowSince !== null && now - lowSince >= 2000
        ? 'Não estamos ouvindo nada. Confira o microfone.'
        : heard ? 'Estamos te ouvindo' : 'Testando o microfone…')
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [engine])
  return (
    <div className="guide__input">
      <span className="guide__meter" aria-hidden="true"><span ref={bar} /></span>
      <span role="status">{inputStatus}</span>
      <p>Use fones: o som das caixas pode vazar na gravação.</p>
    </div>
  )
}
