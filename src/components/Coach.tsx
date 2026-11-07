import { progression } from '../audio/harmony'
import type { ProgressionStyle } from '../audio/harmony'
import { padNotes } from '../audio/scale'
import { INSTRUMENT_OCTAVE } from '../audio/types'
import { chordPitches, setCoachGuidance, rememberInstrument } from './NotePads'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEngine, useEngineState } from '../hooks/useEngine'
import { getCoachStyle } from './GuideBar'
import { Sequencer } from './Sequencer'

const TEXT = [
  'Ligue o bumbo nos tempos 1 e 3 de cada compasso. Clique nas casas que brilham ou ligue REC pads e toque Q no tempo.',
  'Agora a caixa nos tempos 2 e 4 de cada compasso. Use as casas que brilham ou REC pads com W.',
  'Complete com chimbal nas casas pares (uma sim, uma não). Use as casas que brilham ou REC pads com E.',
]
export function Coach() {
  const engine = useEngine()
  const state = useEngineState(engine)
  const [step, setStep] = useState<number | null>(null)
  const [style, setStyle] = useState<string | undefined>(undefined)
  const [target, setTarget] = useState<number | null>(null)
  const [scaleNotice, setScaleNotice] = useState(false)
  const [feedback, setFeedback] = useState('')
  const previousStatus = useRef('empty')
  const mappedStyle: ProgressionStyle = style === 'Lo-fi' ? 'lofi' : style === 'Funk' ? 'funk' : style === 'Reggaeton' ? 'reggaeton' : 'pop'
  useEffect(() => {
    setTarget(null)
    setScaleNotice(false)
    if (step === null || step < 3 || step > 5) return
    const snapshot = engine.getState()
    const index = snapshot.tracks.findIndex((t) => t.kind === 'mic' && t.status === 'empty')
    if (index < 0) return
    const source = step === 3 ? 'bass' : step === 4 ? 'kalimba' : 'ocarina'
    const chords = progression(snapshot.key, snapshot.bpm, snapshot.bars, mappedStyle, 0).chords
    const pitches = padNotes(snapshot.key, snapshot.scale, INSTRUMENT_OCTAVE[source]).map((midi) => midi % 12)
    if (step < 5 && chords.some((chord) => chordPitches(chord, step === 4).some((pitch) => !pitches.includes(pitch)))) {
      engine.setScale('major')
      setScaleNotice(true)
    }
    engine.setTrack(index, { source })
    rememberInstrument(engine, index)
    previousStatus.current = 'empty'
    setTarget(index)
  }, [engine, step, mappedStyle])
  useEffect(() => {
    if (target === null || step === null || step < 3 || step > 5) { setCoachGuidance(engine, null); return }
    const chords = progression(state.key, state.bpm, state.bars, mappedStyle, 0).chords
    setCoachGuidance(engine, { track: target, phase: step === 3 ? 'bass' : step === 4 ? 'harmony' : 'melody', chords })
    const rec = document.querySelector<HTMLButtonElement>(`.strip[aria-labelledby="ch${target + 1}-name"] .rec`)
    rec?.setAttribute('data-coach-record', '')
    return () => { setCoachGuidance(engine, null); rec?.removeAttribute('data-coach-record') }
  }, [engine, target, step, state.key, state.bpm, state.bars, mappedStyle])
  useEffect(() => {
    if (target === null || step === null || step < 3 || step > 5) return
    const status = state.tracks[target]?.status
    if (previousStatus.current === 'recording' && status === 'recorded') {
      setFeedback(`Ficou com sua cara! Quer refazer? Use Regravar na faixa ${target + 1}.`)
      setStep(step + 1)
    }
    previousStatus.current = status ?? 'empty'
  }, [target, step, state.tracks])
  const startButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  function start() {
    setFeedback('')
    setStyle(getCoachStyle(engine))
    if (!state.playing) engine.play()
    setStep(state.pattern.some((row) => row.some(Boolean)) ? -1 : 0)
  }
  function exit() { setStep(null); startButton.current?.focus() }
  useEffect(() => {
    if (step === null || step < 0 || step > 2) return
    const row = state.pattern[step]
    const targets = row?.map((_, i) => i).filter((i) => step === 0 ? i % 16 === 0 || i % 16 === 8 : step === 1 ? i % 16 === 4 || i % 16 === 12 : i % 2 === 0)
    if (targets?.length && targets.every((i) => row[i])) setStep(step + 1)
  }, [step, state.pattern])
  // o play só acontece no gesto de abrir o coach; se a pessoa parar, ela decide quando voltar
  useLayoutEffect(() => {
    if (step !== null && (document.activeElement === document.body || panel.current?.contains(document.activeElement) || document.activeElement === startButton.current)) panel.current?.focus({ preventScroll: true })
  }, [step])
  return <div className="coach-area">
    <button ref={startButton} type="button" className="btn coach__start" disabled={state.status !== 'ready'} onClick={start}>Me ajuda a fazer um ritmo</button>
    {step !== null && <div ref={panel} tabIndex={-1} className="coach" role="region" aria-label="Coach de ritmo" aria-live="polite">
      {style && <p className="coach__style">Vamos montar um ritmo no estilo {style}.</p>}
      {step === -1 ? <>
        <p>Começar do zero na bateria? Você pode usar Desfazer no sequenciador para recuperar o padrão.</p>
        <div className="coach__actions">
          <button className="btn" type="button" onClick={() => { engine.setPattern(state.pattern.map((row) => row.map(() => false))); setStep(0) }}>Começar do zero na bateria</button>
          <button className="btn btn--ghost" type="button" onClick={() => setStep(0)}>Continuar por cima</button>
          <button className="btn btn--ghost" type="button" onClick={exit}>Sair</button>
        </div>
      </> : <>
        <p className="coach__progress">{Math.min(step + 1, 6)} de 6{step === 6 ? ' — concluído' : ''}</p>
        <p>{step < 3 ? `Passo ${step + 1}: ${TEXT[step]}` : step === 3
          ? 'Passo 4 — Baixo: clique em Gravar na faixa indicada e toque a fundamental que acende em cada compasso.'
          : step === 4 ? 'Passo 5 — Harmonia: grave a kalimba e toque as duas notas acesas nos tempos 1 e 3.'
          : step === 5 ? 'Passo 6 — Melodia: agora invente: qualquer pad soa bem. Ou cante na faixa com microfone.'
          : 'Pronto! Bateria, baixo, harmonia e melodia. Ficou com sua cara!'}</p>
        {step >= 3 && step <= 5 && (target === null
          ? <p>Sem faixa livre. Libere uma faixa ou pule este passo.</p>
          : <p>Faixa {target + 1}: use o botão Gravar destacado. A gravação só começa quando você escolher.</p>)}
        {scaleNotice && step >= 3 && step <= 5 && <p>Troquei para a escala maior para incluir todas as notas dos acordes.</p>}
        {feedback && <p>{feedback}</p>}

        <div className="coach__actions">
          {!state.playing && <button type="button" className="btn" disabled={state.status !== 'ready'} onClick={() => engine.play()}>Voltar a tocar</button>}
          {step < 6 && <button type="button" className="btn btn--ghost" onClick={() => setStep(step + 1)}>Pular</button>}
          <button type="button" className="btn btn--ghost" onClick={exit}>Sair</button>
        </div>
      </>}
    </div>}
    <Sequencer coachStep={step !== null && step >= 0 && step < 3 ? step : null} />
  </div>
}
