import { describe, expect, it } from 'vitest'
import { captureLatency, heardTime, isAccent, recordStart, loopDuration, loopOffset, nextLoopStart, positionAt, timeToFrame } from './timing'

describe('timing', () => {
  it('loopDuration', () => {
    expect(loopDuration(120, 1)).toBe(2)
    expect(loopDuration(60, 4)).toBe(16)
    expect(loopDuration(90, 2)).toBeCloseTo(5.3333, 4)
  })

  it('loopOffset', () => {
    expect(loopOffset(10, 10, 2)).toBe(0)
    expect(loopOffset(13.5, 10, 2)).toBeCloseTo(1.5)
    expect(loopOffset(9.5, 10, 2)).toBeCloseTo(1.5) // antes de t0 também cai em [0, dur)
  })

  it('nextLoopStart', () => {
    expect(nextLoopStart(5, 10, 2)).toBe(10)
    expect(nextLoopStart(10, 10, 2)).toBe(10)
    expect(nextLoopStart(10.1, 10, 2)).toBe(12)
    expect(nextLoopStart(14, 10, 2)).toBe(14)
  })

  it('timeToFrame com latência', () => {
    expect(timeToFrame(1, 48000, 0)).toBe(48000)
    expect(timeToFrame(1, 48000, 0.02)).toBe(48960)
    expect(timeToFrame(1, 44100, -0.01)).toBe(43659)
  })

  it('positionAt', () => {
    // 120 bpm, 1 compasso: tempo = 0.5s, loop = 2s, t0 = 10
    expect(positionAt(8.0, 10, 120, 1)).toEqual({ phase: 0, beat: 0, countIn: true })
    expect(positionAt(9.6, 10, 120, 1)).toEqual({ phase: 0, beat: 3, countIn: true })
    const p = positionAt(11.25, 10, 120, 1)
    expect(p.countIn).toBe(false)
    expect(p.phase).toBeCloseTo(0.625)
    expect(p.beat).toBe(2)
    expect(positionAt(13.9, 10, 120, 2).beat).toBe(7)
  })

  it('isAccent', () => {
    expect([-4, -3, 0, 1, 4, 7, 8].map(isAccent)).toEqual([true, false, true, false, true, false, true])
  })

  it('latencyOffset positivo recorta mais tarde (áudio deslocado para mais cedo)', () => {
    expect(captureLatency(0.01, 0.005, 0)).toBeCloseTo(0.015)
    expect(captureLatency(0.01, 0.005, 20)).toBeCloseTo(0.035)
    expect(captureLatency(0.01, 0, -10)).toBeCloseTo(0)
    const sr = 48000
    expect(timeToFrame(2, sr, captureLatency(0.01, 0, 50))).toBeGreaterThan(timeToFrame(2, sr, captureLatency(0.01, 0, 0)))
  })

  it('recordStart pula a virada sem margem para a captura', () => {
    // loop 2s, t0 = 10
    expect(recordStart(10.5, 10, 2, 0.02)).toBe(12)
    expect(recordStart(11.97, 10, 2, 0.02)).toBe(14) // a menos de 50ms da virada
    expect(recordStart(11.8, 10, 2, -0.2)).toBe(14) // offset negativo: frame inicial cairia no passado
    expect(recordStart(11.7, 10, 2, -0.2)).toBe(12)
    expect(recordStart(5, 10, 2, 0)).toBe(10) // contagem: t0 ainda no futuro
    // invariante: início e frame inicial no futuro
    for (const lat of [-0.2, -0.05, 0, 0.03, 0.25]) {
      for (let now = 10; now < 16; now += 0.013) {
        const s = recordStart(now, 10, 2, lat)
        expect(s).toBeGreaterThan(now)
        expect(s + lat).toBeGreaterThanOrEqual(now + 0.05 - 1e-9)
      }
    }
  })

  it('posição ouvida desconta a latência de saída', () => {
    expect(heardTime(10.05, 0.05)).toBeCloseTo(10)
    // já agendado em t0, mas ainda não ouvido: continua na contagem
    expect(positionAt(heardTime(10.01, 0.05), 10, 120, 1).countIn).toBe(true)
  })
})
