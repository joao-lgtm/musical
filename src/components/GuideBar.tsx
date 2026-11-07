import { BAND_EVENT } from './BatchActions'
import { takeStyleAnnouncement } from './stylePresets'
import type { StylePreset } from './stylePresets'
import { INSTRUMENT_LABEL, isInstrument } from '../audio/types'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEngine } from '../hooks/useEngine'
import { surprise } from './drumPresets'
import { loopFilename, renderLoopWav, shareOrDownload } from '../storage/share'
import type { LoopEngine } from '../audio/types'
import type { EngineState } from '../audio/types'

const coachStyles = new WeakMap<LoopEngine, string>()
export const getCoachStyle = (engine: LoopEngine) => coachStyles.get(engine)

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
  const [styleTip, setStyleTip] = useState<StylePreset | null>(null)
  useEffect(() => {
    const receive = () => {
      const style = takeStyleAnnouncement(engine)
      if (!style) return
      coachStyles.set(engine, style.name)
      setStyleTip(style)
    }
    window.addEventListener('loopstudio:style', receive)
    receive()
    return () => window.removeEventListener('loopstudio:style', receive)
  }, [engine])
  useEffect(() => {
    if (!styleTip) return
    const timer = setTimeout(() => setStyleTip(null), 12000)
    return () => clearTimeout(timer)
  }, [styleTip])
  const previousScale = useRef(state.scale)
  const majorTipShown = useRef(false)
  const [majorTip, setMajorTip] = useState(false)
  useEffect(() => {
    if (state.scale === 'major' && previousScale.current !== 'major' && !majorTipShown.current) {
      majorTipShown.current = true
      setMajorTip(true)
    }
    previousScale.current = state.scale
  }, [state.scale])
  useEffect(() => {
    if (!majorTip) return
    const timer = setTimeout(() => setMajorTip(false), 12000)
    return () => clearTimeout(timer)
  }, [majorTip])
  const [bandTip, setBandTip] = useState(false)
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ engine: LoopEngine; active: boolean }>).detail
      if (detail.engine === engine) setBandTip(detail.active)
    }
    window.addEventListener(BAND_EVENT, receive)
    return () => window.removeEventListener(BAND_EVENT, receive)
  }, [engine])
  const guide = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef({ wasInside: false, target: 0 })
  const lastPreset = useRef<string | undefined>(undefined)
  const [offered, setOffered] = useState(calOffered)
  const tipEligible = useRef(!micTipShown())
  const tipActive = useRef(false)
  const [showTip, setShowTip] = useState(false)
  const previousTakes = useRef(state.tracks.map((t) => t.status))
  const [transformTip, setTransformTip] = useState(false)
  const transformTipSeen = useRef(false)
  useEffect(() => {
    if (!transformTipSeen.current && state.tracks.some((t, i) => t.kind === 'mic' && t.source === 'mic' &&
        t.status === 'recorded' && previousTakes.current[i] === 'recording')) {
      transformTipSeen.current = true
      setTransformTip(true)
    }
    previousTakes.current = state.tracks.map((t) => t.status)
  }, [state.tracks])
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
  } else if (layers === 0 && mics[0] && isInstrument(mics[0].source)) {
    msg = <>A batida está rolando. Aperte <kbd>1</kbd> e toque os pads (ou <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd>) durante a gravação.</>
    touchMsg = <>A batida está rolando. Toque em Gravar na faixa 1 e toque os pads durante a gravação.</>
    label = 'Gravar faixa 1'
    action = () => engine.record(0)
  } else if (layers === 0) {
    msg = <>A batida está rolando. Aperte <kbd>1</kbd> e cante, bata palmas ou bata na mesa.</>
    touchMsg = <>A batida está rolando. Toque em Gravar na faixa 1 e cante, bata palmas ou bata na mesa.</>
    label = 'Gravar faixa 1'
    action = () => engine.record(0)
  } else if (layers === 1 && free && mics[free - 1] && isInstrument(mics[free - 1].source)) {
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
    msg = <>Solte a bateria: toque os pads <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> ou peça um “Sortear batida”.</>
    touchMsg = <>Solte a bateria: toque em Sortear batida para criar um ritmo.</>
    label = 'Sortear batida'
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

  const isolated = state.isolateRecording && active >= 0
  const suggestOcarina = layers === 0 || state.mic === 'denied' || state.mic === 'missing'
  if (!msg && !suggestOcarina && !transformTip && !isolated && !styleTip && !majorTip && !bandTip) return null
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
      {bandTip && <p className="guide__secondary" role="status">Agora é sua vez: cante ou toque uma melodia por cima.</p>}
      {majorTip && <p className="guide__secondary" role="status">Escala maior: agora tem todas as notas do tom (Fá e Si inclusive).</p>}
      {styleTip && <p className="guide__secondary" role="status">Estilo {styleTip.name}: a faixa 1 já está como {INSTRUMENT_LABEL[styleTip.instrument]}. Toque os pads ou troque para Microfone.</p>}
      {isolated && <p className="guide__secondary">Gravando isolada: você ouve só esta faixa e o metrônomo.</p>}
      {transformTip && <p className="guide__secondary">Cantou uma melodia? Experimente Transformar → Em ocarina. Dica: cante uma nota de cada vez, tipo “du du du”.</p>}
      {suggestOcarina && <p className="guide__secondary">Sem microfone? Escolha um instrumento na fonte da faixa e toque os pads.</p>}
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
