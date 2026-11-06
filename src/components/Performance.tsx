import { useEffect, useRef } from 'react'
import type { EngineState } from '../audio/types'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'

const SAMPLES = 220 // picos por anel
const TAU = Math.PI * 2

type Ring = { peaks: Float32Array | null; rev: number; status: string; n: number }

/**
 * Modo Performance: um canvas com um anel por canal gravado (forma de onda em volta do círculo,
 * girando com o loop, playhead fixo no topo), bateria como anel de passos e fundo que respira com o master.
 */
export function Performance({ state, onExit }: { state: EngineState; onExit: () => void }) {
  const engine = useEngine()
  const canvas = useRef<HTMLCanvasElement>(null)
  const exit = useRef<HTMLButtonElement>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const colors = useRef<string[]>([])
  const rings = useRef<Ring[]>([])
  const fx = useRef({ glow: 0, kick: 0, lastStep: -1, frame: 0 })
  const stateRef = useRef(state)
  const still = useRef(false)
  useEffect(() => {
    stateRef.current = state
  })

  useEffect(() => {
    exit.current?.focus()
    const c = canvas.current!
    const cs = getComputedStyle(document.documentElement)
    colors.current = Array.from({ length: 9 }, (_, i) => cs.getPropertyValue(`--ch${i + 1}-lit`).trim() || '#fff')
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    still.current = mq.matches
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 2)
      size.current = { w: r.width, h: r.height, dpr }
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  useFrame(() => {
    const c = canvas.current
    const { w, h, dpr } = size.current
    if (!c || !w) return
    const ctx = c.getContext('2d')!
    const s = stateRef.current
    const { pos, levels } = readFrame(engine)
    const f = fx.current
    f.frame++
    const drumsIdx = s.tracks.length - 1

    // relê picos quando o take muda; gravando, a cada 6 frames (cresce ao vivo)
    s.tracks.slice(0, drumsIdx).forEach((t, i) => {
      const r = (rings.current[i] ??= { peaks: null, rev: -1, status: '', n: SAMPLES })
      if (r.rev !== t.revision || r.status !== t.status || (t.status === 'recording' && f.frame % 6 === 0)) {
        r.peaks = t.status === 'empty' || t.status === 'armed' ? null : engine.getPeaks(i, SAMPLES)
        r.rev = t.revision
        r.status = t.status
      }
    })

    // fundo respira com o master; bumbo dá um pulso
    const master = levels[s.tracks.length] ?? 0
    f.glow += (master - f.glow) * 0.12
    const steps = s.pattern[0]?.length ?? 16
    if (pos.playing && !pos.countIn && pos.step !== f.lastStep) {
      if (s.pattern[0]?.[pos.step] && !s.tracks[drumsIdx]?.muted) f.kick = 1
      f.lastStep = pos.step
    }
    f.kick *= 0.9

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cx = w / 2
    const cy = h / 2
    const m = Math.min(w, h)
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.75)
    bg.addColorStop(0, `rgba(120, 140, 255, ${0.08 + f.glow * 0.22 + f.kick * 0.18})`)
    bg.addColorStop(0.55, `rgba(40, 30, 80, ${0.06 + f.glow * 0.1})`)
    bg.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = '#050608'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    const phase = pos.playing && !pos.countIn ? pos.phase : 0
    const rot = still.current ? 0 : -phase * TAU // gira para o trecho atual ficar no topo
    const active = s.tracks.slice(0, drumsIdx).map((t, i) => ({ t, i })).filter(({ t }) => t.status !== 'empty')
    const r0 = m * 0.1
    const rMax = m * 0.38
    const gap = Math.min(m * 0.06, (rMax - r0) / Math.max(1, active.length))

    active.forEach(({ t, i }, k) => {
      const radius = r0 + gap * (k + 0.5)
      const color = colors.current[i]
      const ring = rings.current[i]
      ctx.save()
      ctx.translate(cx, cy)
      if (t.status === 'armed') {
        // armado: círculo tracejado piscando
        ctx.globalAlpha = Math.floor(performance.now() / 350) % 2 ? 0.9 : 0.3
        ctx.strokeStyle = '#ff3b30'
        ctx.setLineDash([4, 6])
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, TAU)
        ctx.stroke()
        ctx.restore()
        return
      }
      const p = ring?.peaks
      if (!p) return ctx.restore()
      const amp = gap * 0.46
      ctx.rotate(rot)
      ctx.lineWidth = Math.max(1.2, (TAU * radius) / SAMPLES - 1.2)
      ctx.lineCap = 'round'
      ctx.strokeStyle = t.status === 'recording' ? '#ff5a4f' : color
      for (let j = 0; j < p.length; j++) {
        const at = j / p.length
        // brilho maior no que acabou de tocar
        const ago = (phase - at + 1) % 1
        ctx.globalAlpha = (t.muted ? 0.25 : 1) * (0.28 + 0.72 * Math.pow(1 - ago, 3))
        const a = -Math.PI / 2 + at * TAU
        const v = Math.max(0.04, Math.min(1, p[j])) * amp
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        ctx.beginPath()
        ctx.moveTo(cos * (radius - v), sin * (radius - v))
        ctx.lineTo(cos * (radius + v), sin * (radius + v))
        ctx.stroke()
      }
      ctx.restore()
    })

    // bateria: anel de pontos, um por passo
    const dr = rMax + m * 0.05
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    for (let st = 0; st < steps; st++) {
      const hits = s.pattern.reduce((n, row) => n + (row[st] ? 1 : 0), 0)
      const a = -Math.PI / 2 + ((st + 0.5) / steps) * TAU
      const now = pos.playing && !pos.countIn && st === pos.step
      ctx.globalAlpha = hits ? (now ? 1 : 0.75) : 0.35
      ctx.fillStyle = now ? '#ffffff' : hits ? colors.current[8] : '#5a606a'
      ctx.shadowColor = colors.current[8]
      ctx.shadowBlur = now && hits ? 18 : 0
      ctx.beginPath()
      ctx.arc(Math.cos(a) * dr, Math.sin(a) * dr, (hits ? 2 + hits * 1.2 : 1.6) * (now ? 1.5 : 1) * (m / 700), 0, TAU)
      ctx.fill()
    }
    ctx.restore()

    // playhead fixo no topo
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#f3f2ed'
    ctx.fillRect(cx - 1, cy - dr - m * 0.03, 2, dr - r0 + m * 0.03 - gap * 0.2)
    ctx.globalAlpha = 1

    // centro pulsa no tempo
    const beatFrac = pos.playing && !pos.countIn ? (pos.phase * s.bars * 4) % 1 : 1
    ctx.beginPath()
    ctx.fillStyle = `rgba(243, 242, 237, ${0.06 + 0.6 * Math.pow(1 - beatFrac, 4)})`
    ctx.arc(cx, cy, r0 * 0.35 * (1 + 0.25 * f.kick), 0, TAU)
    ctx.fill()
  })

  const layers = state.tracks.filter((t, i) => i < state.tracks.length - 1 && t.status === 'recorded').length

  return (
    // foco no próprio palco: Espaço continua controlando o transporte
    <div className="perf" role="dialog" aria-modal="true" aria-label="Modo performance" tabIndex={-1} autoFocus>
      <canvas ref={canvas} className="perf__canvas" aria-hidden="true" />
      <p className="perf__hud perf__hud--meta" role="status">
        <strong>{layers}</strong> {layers === 1 ? 'camada' : 'camadas'} <span aria-hidden="true">·</span> {state.bpm} BPM
      </p>
      <p className="perf__hud perf__hud--keys" aria-hidden="true">
        <kbd>1</kbd>–<kbd>8</kbd> grava · <kbd>Espaço</kbd> · <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd>
      </p>
      <button ref={exit} className="btn btn--sm btn--ghost perf__exit" onClick={onExit}>
        Sair <kbd>Esc</kbd>
      </button>
    </div>
  )
}
