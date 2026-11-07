import { describe, expect, it } from 'vitest'
import { isSilent } from './silence'

describe('isSilent', () => {
  it('considera um buffer zerado silencioso', () => {
    expect(isSilent(new Float32Array(128))).toBe(true)
  })

  it('descarta ruído baixo a -60 dBFS', () => {
    const amplitude = 10 ** (-60 / 20)
    expect(isSilent(Float32Array.from([amplitude, -amplitude, 0]))).toBe(true)
  })

  it('aceita sinal normal a -12 dBFS, incluindo picos negativos', () => {
    expect(isSilent(Float32Array.from([0, -(10 ** (-12 / 20)), 0]))).toBe(false)
  })

  it('considera um buffer vazio silencioso', () => {
    expect(isSilent(new Float32Array())).toBe(true)
  })

  it('usa o limiar configurado e aceita um pico exatamente no limiar', () => {
    expect(isSilent(Float32Array.of(-0.25), -6)).toBe(true)
    expect(isSilent(Float32Array.of(-0.25), -20)).toBe(false)
    expect(isSilent(Float32Array.of(-1), 0)).toBe(false)
  })
})
