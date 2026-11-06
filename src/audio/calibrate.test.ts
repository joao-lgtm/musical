import { describe, expect, it } from 'vitest'
import { detectOnsets, estimateLatency } from './calibrate'

const SR = 48000

// PRNG determinístico (LCG) para ruído e jitter reproduzíveis
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
}

function signal(claps: number[], noise = 0.01, seconds = 5) {
  const r = rng(42)
  const x = new Float32Array(SR * seconds)
  for (let i = 0; i < x.length; i++) x[i] = r() * noise
  for (const t of claps) {
    const s0 = Math.round(t * SR)
    for (let i = 0; i < SR * 0.03 && s0 + i < x.length; i++) x[s0 + i] += r() * 0.8 * Math.exp(-i / (SR * 0.005))
  }
  return x
}

const clicks = Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.5)
const jit = rng(7)
const claps = clicks.map((c) => c + 0.07 + jit() * 0.005)

describe('calibrate', () => {
  it('estima ~70 ms', () => {
    const on = detectOnsets(signal(claps), SR)
    expect(on).toHaveLength(8)
    const r = estimateLatency(clicks, on)!
    expect(r.matched).toBe(8)
    expect(r.offsetMs).toBeGreaterThan(67)
    expect(r.offsetMs).toBeLessThan(73)
    expect(r.jitterMs).toBeLessThan(6)
  })

  it('palma faltando', () => {
    const r = estimateLatency(clicks, detectOnsets(signal(claps.filter((_, i) => i !== 1 && i !== 5)), SR))!
    expect(r.matched).toBe(6)
    expect(Math.abs(r.offsetMs - 70)).toBeLessThan(3)
  })

  it('palma extra fora de hora', () => {
    const r = estimateLatency(clicks, detectOnsets(signal([...claps, clicks[2] + 0.3, 0.1]), SR))!
    expect(r.matched).toBe(8)
    expect(Math.abs(r.offsetMs - 70)).toBeLessThan(3)
  })

  it('ruído alto sem palmas → null', () => {
    const on = detectOnsets(signal([], 0.5), SR)
    expect(on).toEqual([])
    expect(estimateLatency(clicks, on)).toBeNull()
  })

  it('poucas palmas → null', () => {
    expect(estimateLatency(clicks, claps.slice(0, 3))).toBeNull()
  })

  it('duas detecções próximas viram uma', () => {
    expect(detectOnsets(signal([1, 1.03]), SR)).toHaveLength(1)
  })

  it('clamp ±200', () => {
    expect(estimateLatency([0], [0.3])!.offsetMs).toBe(200)
  })
})
