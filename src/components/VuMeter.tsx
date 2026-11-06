import { useRef } from 'react'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'

const HOLD_MS = 900

/** VU com peak-hold; lê getLevels()[index] no loop compartilhado e escreve só CSS vars. */
export function VuMeter({ index, className = '' }: { index: number; className?: string }) {
  const engine = useEngine()
  const el = useRef<HTMLDivElement>(null)
  const s = useRef({ lvl: 0, peak: 0, held: 0, wl: -1, wp: -1 })

  useFrame(() => {
    const node = el.current
    if (!node) return
    const m = readFrame(engine).levels[index] ?? 0 // motor já entrega na escala do meter
    const st = s.current
    const now = performance.now()
    st.lvl = m > st.lvl ? m : st.lvl * 0.9 // sobe na hora, cai suave
    if (m >= st.peak) {
      st.peak = m
      st.held = now
    } else if (now - st.held > HOLD_MS) st.peak = Math.max(0, st.peak - 0.015)
    const l = Math.round(st.lvl * 200) / 200
    const p = Math.round(st.peak * 200) / 200
    if (l !== st.wl) node.style.setProperty('--lvl', String((st.wl = l)))
    if (p !== st.wp) node.style.setProperty('--peak', String((st.wp = p)))
    node.toggleAttribute('data-clip', st.peak > 0.97)
  })

  return (
    <div className={`vu ${className}`} ref={el} aria-hidden="true">
      <div className="vu__fill" />
      <div className="vu__peak" />
    </div>
  )
}
