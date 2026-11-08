import { useEffect, useRef, useState } from 'react'
import { DRUM_SLOTS, KIT_IDS, STEPS_PER_BAR, type KitId } from '../audio/types'
import { KITS } from '../audio/kits'
import { useEngine, useEngineState, useFrame } from '../hooks/useEngine'
import { DiceIcon } from './Icons'
import { DEMO_PRESET, surprise, toPattern } from './drumPresets'
import s from './Sequencer.module.css'

const SLOT_KEYS = ['Q', 'W', 'E', 'R', 'Z', 'X', 'C', 'V']
const SLOT_CODES = SLOT_KEYS.map((key) => `Key${key}`)
const SLOTS = Array.from({ length: DRUM_SLOTS }, (_, i) => i)
const expandedThisSession = () => {
  try { return sessionStorage.getItem('loopstudio.extraDrums') === '1' } catch { return false }
}
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export function Sequencer({ coachStep = null }: { coachStep?: number | null }) {
  const engine = useEngine()
  const state = useEngineState(engine)
  const kit = KITS[state.kit ?? 'acoustic']
  const [expanded, setExpanded] = useState(expandedThisSession)
  const hasExtraSteps = state.pattern.slice(4, DRUM_SLOTS).some((row) => row.some(Boolean))
  const showExtra = expanded || hasExtraSteps
  function expand() {
    setExpanded(true)
    try { sessionStorage.setItem('loopstudio.extraDrums', '1') } catch { /* sem persistência */ }
  }
  useEffect(() => {
    if (hasExtraSteps) expand()
  }, [hasExtraSteps])
  const coachSlot = coachStep === null ? -1 : kit.slots.findIndex((slot) => 'role' in slot && slot.role === ['kick', 'snare', 'hat'][coachStep])
  const coachTarget = coachSlot < 0 ? coachStep : coachSlot
  const ready = state.status === 'ready'
  const steps = state.pattern[0]?.length ?? 0
  const bars = Math.max(1, steps / STEPS_PER_BAR)
  const hasSteps = state.pattern.some((row) => row.includes(true))

  const root = useRef<HTMLDivElement>(null)
  const pads = useRef<(HTMLButtonElement | null)[]>([])
  const lit = useRef(-1)
  const [padRec, setPadRec] = useState(false)

  const hit = (v: number) => {
    engine.triggerDrum(v)
    // REC pads: quantiza ao passo mais próximo do que está sendo ouvido (getPosition já desconta a latência de saída)
    const pos = engine.getPosition()
    if (padRec && pos.playing && !pos.countIn && steps > 0) {
      const step = Math.round(pos.phase * steps) % steps
      if (!engine.getState().pattern[v]?.[step]) engine.toggleStep(v, step, { skipNext: true })
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

  // Q W E R e Z X C V tocam os oito slots, T liga o REC pads (Espaço e números ficam com o App)
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
      const v = SLOT_CODES.indexOf(e.code)
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
    <section className={`${s.seq} drum-seq`} data-expanded={showExtra || undefined} aria-labelledby="seq-title">
      <header className={s.head}>
        <h2 id="seq-title" className={s.title}>Bateria</h2>
        <div className={s.actions}>
          <label className="drum-kit"><span>Kit</span>
            <select aria-label="Kit da bateria" value={state.kit ?? 'acoustic'} disabled={state.status !== 'ready'} onChange={(e) => engine.setKit(e.target.value as KitId)}>
              {KIT_IDS.map((id) => <option key={id} value={id}>{KITS[id].label}</option>)}
            </select>
          </label>
          <span className={s.picked} role="status">{picked && <>Tocando <b>{picked}</b></>}</span>
          <button type="button" className={s.btn} title="Sorteia só o padrão de bateria" aria-label="Sorteia só o padrão de bateria" onClick={onSurprise} disabled={!ready}>
            <DiceIcon size={18} />
            Sortear batida
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

      <div className={`${s.pads} drum-pads`} role="group" aria-label="Pads ao vivo" data-rec={padRec || undefined}>
        {SLOTS.map((v) => (
          <button
            key={v}
            ref={(el) => { pads.current[v] = el }}
            type="button"
            className={s.pad}
            data-voice={v}
            disabled={!ready}
            // pointerdown dá resposta imediata; clique por teclado (detail 0) também toca
            onPointerDown={(e) => { if (e.button === 0) hit(v) }}
            onClick={(e) => { if (e.detail === 0) hit(v) }}
          >
            <span>{kit.slots[v].name}</span>
            <kbd className={s.key} aria-hidden="true">{SLOT_KEYS[v]}</kbd>
          </button>
        ))}
      </div>

      {!showExtra && <button type="button" className="btn btn--ghost drum-more" onClick={expand} aria-expanded={false}>+ mais sons</button>}
      <div data-coach-grid ref={root} className={s.bars}>
        {Array.from({ length: bars }, (_, b) => (
          <div key={b} className={s.bar} role="group" aria-label={`Compasso ${b + 1}`}>
            <span className={s.barNum} aria-hidden="true">{b + 1}</span>
            <div className={s.halves}>
              {[0, 1].map((h) => (
                <div key={h} className={s.half}>
                  {SLOTS.map((v) => (
                    <div key={v} className={s.row} data-voice={v} data-extra-slot={v >= 4 || undefined}>
                      <span className={s.voice} aria-hidden={h === 1}>{kit.slots[v].name}</span>
                      {Array.from({ length: 8 }, (_, k) => {
                        const step = b * STEPS_PER_BAR + h * 8 + k
                        const on = state.pattern[v]?.[step] ?? false
                        return (
                          <button
                            key={step}
                            type="button"
                            className={s.cell}
                            data-coach-target={coachTarget === v && (coachStep === 0 ? step % 16 === 0 || step % 16 === 8 : coachStep === 1 ? step % 16 === 4 || step % 16 === 12 : step % 2 === 0) || undefined}
                            data-step={step}
                            data-beat={k % 4 === 0 ? '' : undefined}
                            aria-pressed={on}
                            aria-label={`${kit.slots[v].name}, passo ${step + 1}`}
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
