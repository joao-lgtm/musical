import { describe, expect, it, vi } from 'vitest'
import { fillPattern, humanize, isFillBar } from './groove'
import { DRUM_VOICES, DRUM_SLOTS } from './types'

describe('fillPattern', () => {
  it('preserva a primeira metade e o bumbo inicial e substitui a segunda metade', () => {
    const base = DRUM_VOICES.map(() => Array<boolean>(32).fill(true))
    const original = structuredClone(base)
    const fill = fillPattern(base)
    expect(fill.map(row => row.length)).toEqual([16, 16, 16, 16])
    expect(fill[0][0]).toBe(true)
    fill.forEach(row => expect(row.slice(0, 8)).toEqual(Array(8).fill(true)))
    expect(fill[1].slice(8)).toEqual([true, false, true, false, true, true, true, true])
    for (const voice of [0, 2, 3]) expect(fill[voice].slice(8)).toEqual(Array(8).fill(false))
    expect(fillPattern(base)).toEqual(fill)
    expect(base).toEqual(original)
    fill[0][0] = false
    expect(base[0][0]).toBe(true)
  })
  it('preserva oito linhas e desce das caixas para o tom na segunda metade', () => {
    const base = Array.from({ length: DRUM_SLOTS }, () => Array<boolean>(32).fill(true))
    const original = structuredClone(base)
    const fill = fillPattern(base)
    expect(fill).toHaveLength(DRUM_SLOTS)
    fill.forEach(row => {
      expect(row).toHaveLength(16)
      expect(row.slice(0, 8)).toEqual(Array(8).fill(true))
    })
    expect(fill[0][0]).toBe(true)
    expect(fill[1].slice(8)).toEqual([true, false, true, false, true, false, false, false])
    expect(fill[5].slice(8)).toEqual([false, false, false, false, false, true, true, true])
    for (const slot of [0, 2, 3, 4, 6, 7]) expect(fill[slot].slice(8)).toEqual(Array(8).fill(false))
    expect(fillPattern(base)).toEqual(fill)
    expect(base).toEqual(original)
  })
  it('suporta outro tamanho de compasso e linhas vazias', () => {
    const fill = fillPattern([], 8)
    expect(fill).toHaveLength(4)
    expect(fill[1]).toEqual([false, false, false, false, true, true, true, true])
    expect(fillPattern([], 0)).toEqual([[], [], [], []])
  })
})

describe('isFillBar', () => {
  it('marca cada quarto compasso absoluto, mesmo em loop de um compasso', () => {
    expect(Array.from({ length: 13 }, (_, bar) => bar).filter(isFillBar)).toEqual([3, 7, 11])
    expect(isFillBar(-1)).toBe(false)
    expect(isFillBar(3.5)).toBe(false)
  })
})

describe('humanize', () => {
  it('mantem limites, acentos fortes e offsets sem antecipar o inicio do take', () => {
    for (const role of ['kick', 'snare', 'hat', 'perc'] as const) for (let step = 0; step < 256; step++) {
      const hit = humanize(role, step, 42)
      const strong = (role === 'kick' || role === 'snare') && step % 4 === 0
      expect(hit.velocity).toBeGreaterThanOrEqual(strong ? 0.95 : 0.75)
      expect(hit.velocity).toBeLessThanOrEqual(strong ? 1 : 0.9)
      expect(Math.abs(hit.offset)).toBeLessThanOrEqual(0.005)
      if (step === 0) expect(hit.offset).toBeGreaterThanOrEqual(0)
    }
  })
  it('acentua o chimbal alternadamente', () => {
    let accented = 0, weak = 0
    for (let seed = 0; seed < 100; seed++) {
      accented += humanize('hat', 2, seed).velocity
      weak += humanize('hat', 3, seed).velocity
    }
    expect(accented / 100).toBeGreaterThan(weak / 100 + 0.04)
  })
  it('permite jitter ligeiramente maior na percussao sem ultrapassar cinco ms', () => {
    let perc = 0, kick = 0
    for (let step = 1; step < 1000; step++) {
      perc += Math.abs(humanize('perc', step, 42).offset)
      kick += Math.abs(humanize('kick', step, 42).offset)
    }
    expect(perc / 999).toBeGreaterThan(kick / 999 + 0.0002)
  })
  it('depende de seed, passo e voz sem usar Math.random', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random proibido') })
    try {
      const hit = humanize('snare', 35, 123)
      expect(humanize('snare', 35, 123)).toEqual(hit)
      expect(humanize('snare', 35, 124)).not.toEqual(hit)
      expect(humanize('snare', 36, 123)).not.toEqual(hit)
      expect(humanize('kick', 35, 123)).not.toEqual(hit)
      expect(humanize('snare', 51, 123)).not.toEqual(hit)
    } finally { random.mockRestore() }
  })
})
