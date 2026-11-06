import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

const tag = (v: DataView, o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)))

describe('wav', () => {
  it('cabeçalho e tamanhos', () => {
    const v = new DataView(encodeWav([new Float32Array(10), new Float32Array(10)], 48000))
    expect(v.byteLength).toBe(44 + 10 * 2 * 2)
    expect(tag(v, 0)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(36 + 40)
    expect(tag(v, 8)).toBe('WAVE')
    expect(tag(v, 12)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(48000 * 4)
    expect(v.getUint16(32, true)).toBe(4)
    expect(v.getUint16(34, true)).toBe(16)
    expect(tag(v, 36)).toBe('data')
    expect(v.getUint32(40, true)).toBe(40)
  })

  it('clamp', () => {
    const v = new DataView(encodeWav([Float32Array.from([2, -2, 0])], 44100))
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
    expect(v.getInt16(48, true)).toBe(0)
  })

  it('intercala estéreo', () => {
    const v = new DataView(encodeWav([Float32Array.from([1, 0]), Float32Array.from([-1, 0.5])], 44100))
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 0, Math.trunc(0.5 * 0x7fff)])
  })
})
