import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

type Props = {
  label: string
  /** nome acessível completo, ex. "Pan, faixa 1" */
  name: string
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  bipolar?: boolean
  format: (v: number) => string
  onChange: (v: number) => void
}

const A0 = 135 // ângulo inicial (graus, sentido horário a partir das 3h)
const SWEEP = 270
const R = 15
const pt = (a: number) => {
  const r = (a * Math.PI) / 180
  return `${20 + R * Math.cos(r)} ${20 + R * Math.sin(r)}`
}
const arc = (a: number, b: number) => (Math.abs(b - a) < 0.5 ? '' : `M ${pt(Math.min(a, b))} A ${R} ${R} 0 ${Math.abs(b - a) > 180 ? 1 : 0} 1 ${pt(Math.max(a, b))}`)

// knob com role=slider: arrastar na vertical, setas/PageUp/Home/End, duplo clique volta ao padrão
export function Knob({ label, name, value, min, max, step, defaultValue, bipolar, format, onChange }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const t = (value - min) / (max - min)
  const ang = A0 + t * SWEEP
  const from = bipolar ? A0 + SWEEP / 2 : A0

  function key(e: KeyboardEvent) {
    const big = step * 10
    const map: Record<string, number> = {
      ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step, ArrowLeft: value - step,
      PageUp: value + big, PageDown: value - big, Home: min, End: max,
    }
    if (!(e.key in map)) return
    e.preventDefault()
    onChange(clamp(map[e.key]))
  }
  function down(e: PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: value }
  }
  function move(e: PointerEvent) {
    if (!drag.current) return
    const range = max - min
    onChange(clamp(drag.current.v + ((drag.current.y - e.clientY) / 140) * range * (e.shiftKey ? 0.2 : 1)))
  }

  return (
    <div className="knob">
      <div
        className="knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onKeyDown={key}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onChange(defaultValue)}
      >
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path className="knob__track" d={arc(A0, A0 + SWEEP)} />
          <path className="knob__val" d={arc(from, ang)} />
          <circle className="knob__cap" cx="20" cy="20" r="10" />
          <line className="knob__ptr" x1="20" y1="20" x2={20 + 9 * Math.cos((ang * Math.PI) / 180)} y2={20 + 9 * Math.sin((ang * Math.PI) / 180)} />
        </svg>
      </div>
      <span className="knob__label" aria-hidden="true">{label}</span>
      <span className="knob__out" aria-hidden="true">{format(value)}</span>
    </div>
  )
}
