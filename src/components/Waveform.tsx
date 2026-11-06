import { useEffect, useRef } from 'react'
import type { TrackStatus } from '../audio/types'
import { readFrame, useEngine, useFrame } from '../hooks/useEngine'

const BAR = 3 // px por barra (2 de traço + 1 de folga)

export function Waveform({ track, status, muted, revision }: { track: number; status: TrackStatus; muted: boolean; revision: number }) {
  const engine = useEngine()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<Float32Array | null>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const colors = useRef({ ch: '#fff', rec: '#f33', dim: '#444' })
  const frame = useRef(0)

  // tamanho real do canvas (DPR) + cores lidas dos tokens CSS
  useEffect(() => {
    const c = canvasRef.current!
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      size.current = { w: r.width, h: r.height, dpr }
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      const cs = getComputedStyle(c)
      colors.current = {
        ch: cs.getPropertyValue('--ch-lit').trim(),
        rec: cs.getPropertyValue('--rec').trim(),
        dim: cs.getPropertyValue('--screen-dim').trim(),
      }
      peaks.current = engine.getPeaks(track, Math.max(8, Math.floor(r.width / BAR)))
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [engine, track])

  useEffect(() => {
    peaks.current = engine.getPeaks(track, Math.max(8, Math.floor(size.current.w / BAR)))
  }, [engine, track, status, revision])

  useFrame(() => {
    const c = canvasRef.current
    const { w, h, dpr } = size.current
    if (!c || !w) return
    const ctx = c.getContext('2d')!
    const pos = readFrame(engine).pos
    const n = Math.max(8, Math.floor(w / BAR))
    // durante a gravação os picos crescem: relê a cada 6 frames
    if (status === 'recording' && frame.current++ % 6 === 0) peaks.current = engine.getPeaks(track, n)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const mid = h / 2
    const head = pos.playing && !pos.countIn ? pos.phase * w : -1
    const { ch, rec, dim } = colors.current
    const p = peaks.current

    if (status === 'recording' && head >= 0) {
      ctx.fillStyle = rec
      ctx.globalAlpha = 0.16
      ctx.fillRect(0, 0, head, h)
      ctx.globalAlpha = 1
    }

    if (!p) {
      ctx.fillStyle = dim
      ctx.fillRect(0, mid - 0.5, w, 1)
    } else {
      for (let i = 0; i < p.length; i++) {
        const x = (i / p.length) * w
        const a = Math.max(1, Math.min(1, p[i]) * (h * 0.44))
        ctx.fillStyle = status === 'recording' ? rec : muted ? dim : ch
        ctx.globalAlpha = muted ? 0.6 : head < 0 || x <= head ? 1 : 0.42
        ctx.fillRect(x, mid - a, BAR - 1, a * 2)
      }
      ctx.globalAlpha = 1
    }

    if (head >= 0 && (p || status === 'recording')) {
      ctx.fillStyle = status === 'recording' ? rec : '#f4f3ee'
      ctx.fillRect(Math.round(head) - 1, 0, 2, h)
    }
  })

  return <canvas ref={canvasRef} className="wave__canvas" aria-hidden="true" />
}
