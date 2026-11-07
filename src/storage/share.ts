import type { LoopEngine } from '../audio/types'
import { audioBufferToWav } from '../audio/wav'

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function loopFilename(bpm: number, ext: string, name?: string): string {
  const extension = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav'
  let stem = (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)) stem = `loop-studio-${stem}`
  return `${stem || `loop-studio-${Number.isFinite(bpm) ? bpm : 120}bpm`}.${extension}`
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  opts?: { title?: string; text?: string },
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try {
    const files = [new File([blob], filename, { type: blob.type })]
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title: opts?.title, text: opts?.text })
      return 'shared'
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled'
  }
  download(blob, filename)
  return 'downloaded'
}

export async function renderLoopWav(engine: LoopEngine, loops: number): Promise<Blob> {
  return audioBufferToWav(await engine.renderMix(loops))
}
