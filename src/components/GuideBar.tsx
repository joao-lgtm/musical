import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { surprise } from './drumPresets'
import { DiceIcon } from './Icons'
import { loopFilename, renderLoopWav, shareOrDownload } from '../storage/share'
import type { LoopEngine } from '../audio/types'
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
  const exportCard = useExportCard(engine, state)
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
  } else if (layers >= 3 && exportCard.available) {
    msg = <>{exportCard.message || 'Ficou bom! Leve seu loop com você.'}</>
    label = exportCard.busy ? 'Preparando…' : exportCard.canShare ? 'Compartilhar' : 'Baixar o loop'
    action = () => { void exportCard.save() }
  } else if (layers === 0 && mics[0]?.source === 'ocarina') {
    msg = <>A batida está rolando. Aperte <kbd>1</kbd> e toque os pads (ou <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd>) durante a gravação.</>
    touchMsg = <>A batida está rolando. Toque em Gravar na faixa 1 e toque os pads durante a gravação.</>
    label = 'Gravar faixa 1'
    action = () => engine.record(0)
  } else if (layers === 0) {
    msg = <>A batida está rolando. Aperte <kbd>1</kbd> e cante, bata palmas ou bata na mesa.</>
    touchMsg = <>A batida está rolando. Toque em Gravar na faixa 1 e cante, bata palmas ou bata na mesa.</>
    label = 'Gravar faixa 1'
    action = () => engine.record(0)
  } else if (layers === 1 && free && mics[free - 1]?.source === 'ocarina') {
    msg = <>Boa! Aperte <kbd>{free}</kbd> e toque os pads (ou <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd>) durante a gravação.</>
    touchMsg = <>Boa! Toque em Gravar e toque os pads durante a gravação para adicionar outra camada.</>
    label = `Gravar faixa ${free}`
    action = () => engine.record(free - 1)
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

  const showingExport = layers >= 3 && active < 0 && !silentWarning && !micUnavailable && state.mic !== 'requesting' && exportCard.available

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

  const suggestOcarina = layers === 0 || state.mic === 'denied' || state.mic === 'missing'
  if (!msg && !suggestOcarina) return null
  const offerCal = mics.some((track) => track.status === 'recorded' && track.source === 'mic') && !micUnavailable && state.mic !== 'requesting' && !silentWarning && layers === 1 && recording < 0 && armed < 0 && !offered
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
      {label && <button type="button" className={showingExport ? 'btn btn--primary guide__action' : 'btn guide__action'} onClick={action}
        disabled={state.status !== 'ready' || (showingExport && exportCard.busy)} aria-busy={showingExport && exportCard.busy || undefined}>
        {label}
      </button>}
      {showingExport && <button type="button" className="btn btn--ghost guide__dismiss" disabled={exportCard.busy} onClick={exportCard.dismiss}>Agora não</button>}
      {suggestOcarina && <p className="guide__secondary">Sem microfone? Troque a faixa para Ocarina e toque os pads.</p>}
      {showTip && mics[active]?.source === 'mic' && state.mic === 'ready' && active >= 0 && !silentWarning && (
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

function useExportCard(engine: LoopEngine, state: EngineState) {
  const signature = state.tracks.slice(0, -1).map((t, i) => t.status === 'recorded' ? `${i}:${t.revision}` : '').join('|')
  const layers = state.tracks.slice(0, -1).filter((t) => t.status === 'recorded').length
  const elapsed = useRef(0)
  const previous = useRef(signature)
  const [available, setAvailable] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [message, setMessage] = useState('')
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mounted = useRef(true)
  const [canShare] = useState(() => {
    try { return !!navigator.canShare?.({ files: [new File([], 'x.wav', { type: 'audio/wav' })] }) }
    catch { return false }
  })
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(messageTimer.current) }
  }, [])
  useEffect(() => {
    if (previous.current !== signature) {
      previous.current = signature
      elapsed.current = 0
      setAvailable(false)
      setDismissed(false)
      setMessage('')
      clearTimeout(messageTimer.current)
    }
    if (layers < 3 || !state.playing || state.loopDuration <= 0) return
    const started = performance.now()
    const remaining = Math.max(0, state.loopDuration * 2000 - elapsed.current)
    const timer = setTimeout(() => setAvailable(true), remaining)
    return () => {
      clearTimeout(timer)
      elapsed.current += performance.now() - started
    }
  }, [signature, layers, state.playing, state.loopDuration])
  async function save() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setMessage('')
    clearTimeout(messageTimer.current)
    const focused = document.activeElement
    try {
      const blob = await renderLoopWav(engine, 2)
      const result = await shareOrDownload(blob, loopFilename(state.bpm, 'wav'), {
        title: 'Meu loop no Loop Studio', text: 'Fiz este loop no Loop Studio',
      })
      if (!mounted.current) return
      if (result !== 'cancelled') {
        setMessage(result === 'shared' ? 'Loop compartilhado.' : 'Loop baixado.')
        messageTimer.current = setTimeout(() => setMessage(''), 3000)
      }
    } catch {
      if (mounted.current) setMessage('Não deu para gerar o áudio. Tente de novo.')
    } finally {
      saving.current = false
      if (mounted.current) {
        setBusy(false)
        requestAnimationFrame(() => {
          if (mounted.current && focused instanceof HTMLButtonElement && focused.isConnected &&
              (document.activeElement === document.body || document.activeElement === focused)) focused.focus({ preventScroll: true })
        })
      }
    }
  }
  return { available: available && !dismissed, busy, message, canShare, save, dismiss: () => setDismissed(true) }
}
