import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopEngine } from '../audio/types'
import { download, loopFilename, renderLoopWav, shareOrDownload } from './share'

const click = vi.fn()
const createObjectURL = vi.fn(() => 'blob:loop')
const revokeObjectURL = vi.fn()
let anchor: { href: string; download: string; click: typeof click }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  anchor = { href: '', download: '', click }
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  vi.stubGlobal('navigator', {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('download', () => {
  it('clica no link e revoga a URL apos 10 segundos', () => {
    const blob = new Blob(['loop'])
    download(blob, 'loop.wav')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(anchor.href).toBe('blob:loop')
    expect(anchor.download).toBe('loop.wav')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(9999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:loop')
  })
})

describe('loopFilename', () => {
  it('preserva o fallback atual', () => {
    expect(loopFilename(120, 'wav')).toBe('loop-studio-120bpm.wav')
    expect(loopFilename(95, '.WEBM', '   ')).toBe('loop-studio-95bpm.webm')
    expect(loopFilename(90, 'wav', '??')).toBe('loop-studio-90bpm.wav')
  })

  it('remove acentos, caminhos e caracteres invalidos', () => {
    expect(loopFilename(120, 'wav', '  Canção / verão: take?*  ')).toBe('Cancao-verao-take.wav')
    expect(loopFilename(120, '../wav', '../Meu loop')).toBe('Meu-loop.wav')
  })

  it('protege nomes reservados, tamanho e extensao', () => {
    expect(loopFilename(120, 'wav', 'CON')).toBe('loop-studio-CON.wav')
    expect(loopFilename(120, '', 'LPT1')).toBe('loop-studio-LPT1.wav')
    expect(loopFilename(120, 'wav', 'a'.repeat(200))).toHaveLength(124)
  })
})

describe('shareOrDownload', () => {
  const blob = new Blob(['loop'], { type: 'audio/wav' })

  it('compartilha o File e os metadados quando suportado', async () => {
    const canShare = vi.fn(() => true)
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare, share })
    expect(await shareOrDownload(blob, 'meu.wav', { title: 'Meu loop', text: 'Ouça' })).toBe('shared')
    const data = share.mock.calls[0][0] as ShareData
    expect(data.title).toBe('Meu loop')
    expect(data.text).toBe('Ouça')
    const file = data.files![0]
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('meu.wav')
    expect(file.type).toBe('audio/wav')
    expect(await file.text()).toBe('loop')
    expect(canShare).toHaveBeenCalledWith({ files: data.files })
    expect(click).not.toHaveBeenCalled()
  })

  it('retorna cancelled para AbortError sem baixar', async () => {
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: vi.fn().mockRejectedValue(new DOMException('Cancelado', 'AbortError')),
    })
    expect(await shareOrDownload(blob, 'loop.wav')).toBe('cancelled')
    expect(click).not.toHaveBeenCalled()
  })

  it('baixa quando nao ha suporte', async () => {
    expect(await shareOrDownload(blob, 'loop.wav')).toBe('downloaded')
    expect(anchor.download).toBe('loop.wav')
    expect(click).toHaveBeenCalledOnce()
  })

  it('baixa quando canShare retorna false', async () => {
    const share = vi.fn()
    vi.stubGlobal('navigator', { canShare: () => false, share })
    expect(await shareOrDownload(blob, 'loop.wav')).toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledOnce()
  })

  it('baixa quando a verificacao ou o compartilhamento falham', async () => {
    for (const navigator of [
      { canShare: () => { throw new Error('Falhou') } },
      { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('Falhou')) },
      { canShare: () => true },
    ]) {
      vi.stubGlobal('navigator', navigator)
      expect(await shareOrDownload(blob, 'loop.wav')).toBe('downloaded')
    }
    expect(click).toHaveBeenCalledTimes(3)
  })
})

describe('renderLoopWav', () => {
  it('repassa loops ao motor e codifica o buffer como WAV', async () => {
    const renderMix = vi.fn().mockResolvedValue({
      numberOfChannels: 1, sampleRate: 48000,
      getChannelData: () => Float32Array.from([0, 1, -1]),
    })
    const blob = await renderLoopWav({ renderMix } as unknown as LoopEngine, 4)
    expect(renderMix).toHaveBeenCalledWith(4)
    expect(blob.type).toBe('audio/wav')
    const data = new DataView(await blob.arrayBuffer())
    expect(data.byteLength).toBe(50)
    expect(data.getUint32(24, true)).toBe(48000)
    expect(data.getInt16(46, true)).toBe(32767)
    expect(click).not.toHaveBeenCalled()
  })

  it('propaga falha do render sem baixar', async () => {
    const error = new Error('Render falhou')
    const engine = { renderMix: vi.fn().mockRejectedValue(error) } as unknown as LoopEngine
    await expect(renderLoopWav(engine, 2)).rejects.toBe(error)
    expect(click).not.toHaveBeenCalled()
  })
})
