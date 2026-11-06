import { useRef } from 'react'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'

// Números gigantes 4-3-2-1 no centro da tela, batendo no tempo da contagem
export function CountIn() {
  const engine = useEngine()
  const root = useRef<HTMLDivElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const last = useRef(-1)

  useFrame(() => {
    const el = root.current
    if (!el || !num.current) return
    const p = readFrame(engine).pos
    const n = p.playing && p.countIn ? 4 - (p.beat % 4) : 0
    if (n === last.current) return
    last.current = n
    el.toggleAttribute('data-on', n > 0)
    if (!n) return
    num.current.textContent = String(n)
    num.current.animate(
      [
        { transform: 'scale(1.3)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0.8 },
      ],
      { duration: (60 / engine.getState().bpm) * 1000, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    )
  })

  return (
    <div className="countin" ref={root} aria-hidden="true">
      <span className="countin__label">Contagem</span>
      <span className="countin__num" ref={num} />
    </div>
  )
}
