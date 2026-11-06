import { useRef } from 'react'
import { STEPS_PER_BAR } from '../audio/types'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'

// LEDs de tempo + fileira de passos + leitura "compasso.tempo"; tudo via rAF, sem re-render
export function BeatIndicator({ bars }: { bars: number }) {
  const engine = useEngine()
  const rootRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLSpanElement>(null)
  const last = useRef('')

  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    const p = readFrame(engine).pos
    const key = `${bars}|${p.playing}|${p.countIn}|${p.beat}|${p.step}`
    if (key === last.current) return
    last.current = key
    root.dataset.mode = !p.playing ? 'idle' : p.countIn ? 'count' : 'play'
    root.querySelectorAll<HTMLElement>('.led').forEach((el, i) => {
      el.toggleAttribute('data-on', p.playing && (p.countIn ? i === p.beat % 4 : i === p.beat))
    })
    root.querySelectorAll<HTMLElement>('.step').forEach((el, i) => {
      el.toggleAttribute('data-on', p.playing && !p.countIn && i === p.step)
    })
    if (readRef.current) {
      readRef.current.textContent = !p.playing
        ? '—'
        : p.countIn
          ? String(4 - (p.beat % 4))
          : `${Math.floor(p.beat / 4) + 1}.${(p.beat % 4) + 1}`
    }
  })

  return (
    <div className="beat" ref={rootRef} data-mode="idle">
      <div className="beat__read">
        <span className="beat__label beat__label--play">Compasso.tempo</span>
        <span className="beat__label beat__label--count">Contagem</span>
        <span className="beat__label beat__label--idle">Parado</span>
        <span className="beat__num" ref={readRef} aria-hidden="true">—</span>
      </div>
      <div className="beat__grid" aria-hidden="true">
        <div className="beat__leds">
          {Array.from({ length: bars }, (_, b) => (
            <div className="beat__bar" key={b}>
              {[0, 1, 2, 3].map((t) => <span className={`led${t === 0 ? ' led--down' : ''}`} key={t} />)}
            </div>
          ))}
        </div>
        <div className="beat__steps">
          {Array.from({ length: bars }, (_, b) => (
            <div className="beat__bar" key={b}>
              {Array.from({ length: STEPS_PER_BAR }, (_, s) => <span className={`step${s % 4 === 0 ? ' step--beat' : ''}`} key={s} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
