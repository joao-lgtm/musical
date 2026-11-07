import { useEffect, useRef, useState } from 'react'
import { DRUM_VOICES, STEPS_PER_BAR, type DrumVoice } from '../audio/types'
import { useEngine, useEngineState, useFrame } from '../hooks/useEngine'
import { BatchActions } from './BatchActions'
import { DEMO_PRESET, surprise, toPattern } from './drumPresets'
import s from './Sequencer.module.css'

const VOICES: Record<DrumVoice, { name: string; key: string }> = {
  kick: { name: 'Bumbo', key: 'Q' },
  snare: { name: 'Caixa', key: 'W' },
  hat: { name: 'Chimbal', key: 'E' },
  clap: { name: 'Palmas', key: 'R' },
}
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export function Sequencer({ coachStep = null }: { coachStep?: number | null }) {
  const engine = useEngine()
  const state = useEngineState(engine)
  const ready = state.status === 'ready'
  const steps = state.pattern[0]?.length ?? 0
  const bars = Math.max(1, steps / STEPS_PER_BAR)
  const hasSteps = state.pattern.some((row) => row.includes(true))

  const root = useRef<HTMLDivElement>(null)
  const pads = useRef<(HTMLButtonElement | null)[]>([])
  const lit = useRef(-1)
  const [padRec, setPadRec] = useState(false)

  const hit = (v: number) => {
    engine.triggerDrum(DRUM_VOICES[v])
    // REC pads: quantiza ao passo mais próximo do que está sendo ouvido (getPosition já desconta a latência de saída)
    const pos = engine.getPosition()
    if (padRec && pos.playing && !pos.countIn && steps > 0) {
      const step = Math.round(pos.phase * steps) % steps
      if (!engine.getState().pattern[v][step]) engine.toggleStep(v, step, { skipNext: true })
      root.current?.querySelector(`[data-voice="${v}"] > [data-step="${step}"]`)?.animate(
        [{ boxShadow: '0 0 0 3px #fff, 0 0 24px var(--c)' }, { boxShadow: '0 0 0 0 transparent' }],
        { duration: 450, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
    }
    pads.current[v]?.animate(
      [{ transform: 'scale(0.94)', filter: 'brightness(1.6)' }, { transform: 'none', filter: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }
  const hitRef = useRef(hit)
  useEffect(() => {
    hitRef.current = hit
  })

  // Playhead: marca as células do passo ouvido direto no DOM, sem re-render
  useFrame(() => {
    const pos = engine.getPosition()
    const step = pos.playing && !pos.countIn ? pos.step : -1
    if (step === lit.current || !root.current) return
    root.current.querySelectorAll('[data-now]').forEach((el) => el.removeAttribute('data-now'))
    if (step >= 0) root.current.querySelectorAll(`[data-step="${step}"]`).forEach((el) => el.setAttribute('data-now', ''))
    lit.current = step
  })

  // Q W E R tocam as vozes, T liga o REC pads (Espaço e números ficam com o App)
  useEffect(() => {
    if (!ready) return
    const down = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest(FIELD)) return
      if (e.code === 'KeyT') {
        e.preventDefault()
        return setPadRec((on) => !on)
      }
      const v = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(e.code)
      if (v < 0) return
      e.preventDefault()
      hitRef.current(v)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [ready])

  const [picked, setPicked] = useState<string | null>(null)
  const last = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const onSurprise = () => {
    last.current = surprise(engine, last.current)
    setPicked(last.current)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPicked(null), 2000)
  }

  return (
    <section className={s.seq} aria-labelledby="seq-title">
      <header className={s.head}>
        <h2 id="seq-title" className={s.title}>Bateria</h2>
        <div className={s.actions}>
          <span className={s.picked} role="status">{picked && <>Tocando <b>{picked}</b></>}</span>
          <button type="button" className={s.surprise} onClick={onSurprise} disabled={!ready}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" />
              <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" />
            </svg>
            Surpreenda-me
          </button>
          <button type="button" className={`${s.btn} ${s.padRec}`} aria-pressed={padRec} onClick={() => setPadRec((on) => !on)} disabled={!ready} title={state.playing ? undefined : 'Dê play para gravar os pads'}>
            <span className={s.padRecDot} aria-hidden="true" />
            REC pads
            <kbd className={s.key} aria-hidden="true">T</kbd>
          </button>
          <button type="button" className={s.btn} onClick={() => engine.setPattern(toPattern(DEMO_PRESET))} disabled={!ready}>
            Padrão exemplo
          </button>
          <button type="button" className={s.btn} onClick={() => engine.clear(state.tracks.length - 1)} disabled={!ready || !hasSteps}>
            Limpar padrão
          </button>
        </div>
      </header>

      <BatchActions />
      <div className={s.pads} role="group" aria-label="Pads ao vivo" data-rec={padRec || undefined}>
        {DRUM_VOICES.map((voice, v) => (
          <button
            key={voice}
            ref={(el) => { pads.current[v] = el }}
            type="button"
            className={s.pad}
            data-voice={v}
            disabled={!ready}
            // pointerdown dá resposta imediata; clique por teclado (detail 0) também toca
            onPointerDown={(e) => { if (e.button === 0) hit(v) }}
            onClick={(e) => { if (e.detail === 0) hit(v) }}
          >
            <span>{VOICES[voice].name}</span>
            <kbd className={s.key} aria-hidden="true">{VOICES[voice].key}</kbd>
          </button>
        ))}
      </div>

      <div data-coach-grid ref={root} className={s.bars}>
        {Array.from({ length: bars }, (_, b) => (
          <div key={b} className={s.bar} role="group" aria-label={`Compasso ${b + 1}`}>
            <span className={s.barNum} aria-hidden="true">{b + 1}</span>
            <div className={s.halves}>
              {[0, 1].map((h) => (
                <div key={h} className={s.half}>
                  {DRUM_VOICES.map((voice, v) => (
                    <div key={voice} className={s.row} data-voice={v}>
                      <span className={s.voice} aria-hidden={h === 1}>{VOICES[voice].name}</span>
                      {Array.from({ length: 8 }, (_, k) => {
                        const step = b * STEPS_PER_BAR + h * 8 + k
                        const on = state.pattern[v][step]
                        return (
                          <button
                            key={step}
                            type="button"
                            className={s.cell}
                            data-coach-target={coachStep === v && (v === 0 ? step % 16 === 0 || step % 16 === 8 : v === 1 ? step % 16 === 4 || step % 16 === 12 : step % 2 === 0) || undefined}
                            data-step={step}
                            data-beat={k % 4 === 0 ? '' : undefined}
                            aria-pressed={on}
                            aria-label={`${VOICES[voice].name}, passo ${step + 1}`}
                            disabled={!ready}
                            onClick={() => engine.toggleStep(v, step)}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
