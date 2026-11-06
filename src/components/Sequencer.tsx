import { useEffect, useRef, useState } from 'react'
import { DRUM_VOICES, STEPS_PER_BAR, type DrumVoice } from '../audio/types'
import { useEngine, useEngineState, useFrame } from '../hooks/useEngine'
import { DEMO_PRESET, DRUM_PRESETS, toPattern } from './drumPresets'
import s from './Sequencer.module.css'

const VOICES: Record<DrumVoice, { name: string; key: string }> = {
  kick: { name: 'Bumbo', key: 'Q' },
  snare: { name: 'Caixa', key: 'W' },
  hat: { name: 'Chimbal', key: 'E' },
  clap: { name: 'Palmas', key: 'R' },
}
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export function Sequencer() {
  const engine = useEngine()
  const state = useEngineState(engine)
  const ready = state.status === 'ready'
  const steps = state.pattern[0]?.length ?? 0
  const bars = Math.max(1, steps / STEPS_PER_BAR)
  const hasSteps = state.pattern.some((row) => row.includes(true))

  const root = useRef<HTMLDivElement>(null)
  const pads = useRef<(HTMLButtonElement | null)[]>([])
  const lit = useRef(-1)

  const hit = (v: number) => {
    engine.triggerDrum(DRUM_VOICES[v])
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

  // Q W E R tocam as vozes (Espaço e números ficam com o App)
  useEffect(() => {
    if (!ready) return
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest(FIELD)) return
      const v = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(e.code)
      if (v < 0) return
      e.preventDefault()
      hitRef.current(v)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [ready])

  const [picked, setPicked] = useState<string | null>(null)
  const last = useRef(-1)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Sorteia um preset diferente do anterior e já põe para tocar
  const surprise = () => {
    let i = Math.floor(Math.random() * DRUM_PRESETS.length)
    if (i === last.current) i = (i + 1) % DRUM_PRESETS.length
    last.current = i
    engine.setPattern(toPattern(DRUM_PRESETS[i]))
    if (!engine.getState().playing) engine.play()
    setPicked(DRUM_PRESETS[i].name)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPicked(null), 2000)
  }

  return (
    <section className={s.seq} aria-labelledby="seq-title">
      <header className={s.head}>
        <h2 id="seq-title" className={s.title}>Bateria</h2>
        <div className={s.actions}>
          <span className={s.picked} role="status">{picked && <>Tocando <b>{picked}</b></>}</span>
          <button type="button" className={s.surprise} onClick={surprise} disabled={!ready}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" />
              <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" />
              <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" />
            </svg>
            Surpreenda-me
          </button>
          <button type="button" className={s.btn} onClick={() => engine.setPattern(toPattern(DEMO_PRESET))} disabled={!ready}>
            Padrão exemplo
          </button>
          <button type="button" className={s.btn} onClick={() => engine.clear(state.tracks.length - 1)} disabled={!ready || !hasSteps}>
            Limpar padrão
          </button>
        </div>
      </header>

      <div className={s.pads} role="group" aria-label="Pads ao vivo">
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

      <div ref={root} className={s.bars}>
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
