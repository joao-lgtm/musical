import { useRef } from 'react'
import { engine, useFrame } from '../hooks/useEngine'

// LEDs de tempo + leitura "compasso.tempo"; atualizado por rAF, sem re-render
export function BeatIndicator({ bars }: { bars: number }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLSpanElement>(null)
  const last = useRef('')

  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    const p = engine.getPosition()
    const key = `${bars}|${p.playing}|${p.countIn}|${p.beat}`
    if (key === last.current) return
    last.current = key
    root.dataset.mode = !p.playing ? 'idle' : p.countIn ? 'count' : 'play'
    const leds = root.querySelectorAll<HTMLElement>('.led')
    leds.forEach((el, i) => {
      // na contagem acende só o primeiro compasso
      const on = p.playing && (p.countIn ? i === p.beat % 4 : i === p.beat)
      el.toggleAttribute('data-on', on)
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
      <div className="beat__leds" aria-hidden="true">
        {Array.from({ length: bars }, (_, b) => (
          <div className="beat__bar" key={b}>
            {[0, 1, 2, 3].map((t) => <span className={`led${t === 0 ? ' led--down' : ''}`} key={t} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
