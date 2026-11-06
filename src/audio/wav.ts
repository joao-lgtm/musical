/** WAV PCM 16-bit, canais intercalados. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nch = channels.length
  const frames = nch ? channels[0].length : 0
  const dataSize = frames * nch * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }

  str(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, nch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * nch * 2, true)
  v.setUint16(32, nch * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataSize, true)

  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return buf
}

export function audioBufferToWav(b: AudioBuffer): Blob {
  const chs = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))
  return new Blob([encodeWav(chs, b.sampleRate)], { type: 'audio/wav' })
}
