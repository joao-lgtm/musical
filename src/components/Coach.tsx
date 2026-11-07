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
  const startButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  function start() {
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
  useEffect(() => {
    if (step !== null && state.status === 'ready' && !state.playing && !document.querySelector('dialog[open]')) engine.play()
  }, [engine, step, state.status, state.playing])
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
        <p className="coach__progress">{Math.min(step + 1, 3)} de 6{step === 3 ? ' — bateria concluída' : ''}</p>
        <p>{step < 3 ? `Passo ${step + 1}: ${TEXT[step]}` : 'Esse é o ritmo base do pop!'}</p>
        <p className="coach__future">4. Baixo — em breve · 5. Kalimba — em breve · 6. Melodia — em breve</p>
        <div className="coach__actions">
          {step < 3 && <button type="button" className="btn btn--ghost" onClick={() => setStep(step + 1)}>Pular</button>}
          <button type="button" className="btn btn--ghost" onClick={exit}>Sair</button>
        </div>
      </>}
    </div>}
    <Sequencer coachStep={step !== null && step >= 0 && step < 3 ? step : null} />
  </div>
}
