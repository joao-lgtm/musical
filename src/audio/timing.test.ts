import { describe, expect, it } from 'vitest'
import {
  calibrationPlan,
  captureLatency,
  delayTime,
  filterFreq,
  heardTime,
  isAccent,
  nudgedOffset,
  overdubMix,
  recordStart,
  renderWindow,
  fxTail,
  resample,
  resizePattern,
  stepDuration,
  loopDuration,
  loopOffset,
  liveStepToSkip,
  nextLoopStart,
  positionAt,
  timeToFrame,
  vuLevel,
} from './timing'

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
    expect(positionAt(8.0, 10, 120, 1)).toEqual({ phase: 0, beat: 0, step: 0, countIn: true })
    expect(positionAt(9.6, 10, 120, 1)).toEqual({ phase: 0, beat: 3, step: 0, countIn: true })
    const p = positionAt(11.25, 10, 120, 1)
    expect(p.countIn).toBe(false)
    expect(p.phase).toBeCloseTo(0.625)
    expect(p.beat).toBe(2)
    expect(p.step).toBe(10)
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

  it('passos, delay e nudge', () => {
    expect(stepDuration(120)).toBe(0.125)
    expect(delayTime(120)).toBe(0.375)
    expect(positionAt(13.99, 10, 120, 2).step).toBe(31)
    // loop 2s, t0 = 10: nudge +0.1 → no instante 10.5 o take está em 0.4
    expect(nudgedOffset(10.5, 10, 2, 0.1)).toBeCloseTo(0.4)
    expect(nudgedOffset(10, 10, 2, 0.1)).toBeCloseTo(1.9)
    expect(nudgedOffset(10, 10, 2, -0.1)).toBeCloseTo(0.1)
  })

  it('filtro e VU', () => {
    expect(filterFreq(0)).toBe(200)
    expect(filterFreq(1)).toBeCloseTo(20000)
    expect(filterFreq(0.5)).toBeCloseTo(2000)
    expect(vuLevel(0)).toBe(0)
    expect(vuLevel(1)).toBe(1)
    expect(vuLevel(2)).toBe(1)
    expect(vuLevel(Math.pow(10, -24 / 20))).toBeCloseTo(0.5)
  })

  it('resizePattern repete compassos ou corta', () => {
    const p = [[true, false], [false, true]]
    expect(resizePattern(p, 4)).toEqual([[true, false, true, false], [false, true, false, true]])
    expect(resizePattern([[true, false, false, true]], 2)).toEqual([[true, false]])
    expect(resizePattern([[]], 3)).toEqual([[false, false, false]])
  })

  it('resample e overdubMix', () => {
    expect(Array.from(resample(new Float32Array([0, 1]), 4))).toEqual([0, 0.5, 1, 1])
    const take = new Float32Array([1, 0, 0, 0])
    const layer = new Float32Array([0, 1, 0, 0])
    expect(Array.from(overdubMix(take, layer, 0))).toEqual([1, 1, 0, 0])
    // take com nudge de 1 amostra: amostra j do take toca no instante j+1 do loop
    expect(Array.from(overdubMix(take, layer, 1))).toEqual([2, 0, 0, 0])
    expect(Array.from(overdubMix(take, layer, -1))).toEqual([1, 0, 1, 0])
  })

  it('calibrationPlan', () => {
    const p = calibrationPlan(10, 120, 4)
    // 1 compasso (2s) + 0.1 de margem
    expect(p.clickTimes).toEqual([12.1, 12.6, 13.1, 13.6])
    expect(p.start).toBeCloseTo(11.8)
    expect(p.end).toBeCloseTo(14.1)
  })

  it('renderWindow: pre-roll de 1 loop, recorta os loops finais', () => {
    expect(renderWindow(2, 2, 48000)).toEqual({ loops: 2, start: 96000, length: 192000, total: 288000 })
    expect(renderWindow(0, 1.5, 44100)).toEqual({ loops: 1, start: 66150, length: 66150, total: 132300 })
  })

  it('renderWindow: pre-roll cobre a cauda de FX em loops inteiros', () => {
    // 1 compasso a 180 bpm = 1.333s; cauda ≥ 2.5s → 2 loops de aquecimento
    const dur = loopDuration(180, 1)
    const tail = fxTail(180)
    expect(tail).toBeGreaterThanOrEqual(2.5)
    const w = renderWindow(1, dur, 48000, tail)
    expect(w.start).toBe(Math.round(Math.ceil(tail / dur) * dur * 48000))
    expect(w.start / 48000).toBeGreaterThanOrEqual(tail)
  })
})

describe('liveStepToSkip', () => {
  it('pula o passo futuro arredondado fora do lookahead', () => {
    // 60 BPM: passo 4 em 1s; pad em 0.875s, antes do lookahead de 100ms.
    expect(liveStepToSkip(4, 16, 3.5, 4)).toBe(4)
  })

  it('não pula a volta seguinte se a ocorrência já foi processada', () => {
    expect(liveStepToSkip(4, 16, 3.8, 5)).toBeNull()
    expect(liveStepToSkip(4, 16, 4.2, 5)).toBeNull()
  })

  it('identifica somente a ocorrência do ciclo atual', () => {
    const skipped = liveStepToSkip(4, 16, 19.7, 20)
    expect(skipped).toBe(20)
    expect([20, 36, 52].filter((step) => step !== skipped)).toEqual([36, 52])
  })

  it('trata o arredondamento para zero na virada do loop', () => {
    expect(liveStepToSkip(0, 16, 15.7, 16)).toBe(16)
    expect(liveStepToSkip(0, 16, 15.7, 17)).toBeNull()
    expect(liveStepToSkip(0, 32, 63.7, 64)).toBe(64)
  })

  it('mantém o passo recebido se o relógio avançar entre a UI e o motor', () => {
    expect(liveStepToSkip(15, 16, 15.51, 16)).toBeNull()
    expect(liveStepToSkip(15, 16, 15.51, 15)).toBe(15)
  })

  it('identifica uma ocorrência atrasada para ser consumida sem afetar outra volta', () => {
    expect(liveStepToSkip(4, 16, 4.2, 3)).toBe(4)
  })
})
