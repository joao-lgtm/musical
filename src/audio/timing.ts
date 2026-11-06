// Matemática de tempo pura (segundos no relógio do AudioContext).

export const BEATS_PER_BAR = 4

export const beatDuration = (bpm: number) => 60 / bpm

export const loopDuration = (bpm: number, bars: number) => bars * BEATS_PER_BAR * beatDuration(bpm)

/** Posição dentro do loop, sempre em [0, dur). */
export function loopOffset(when: number, t0: number, dur: number) {
  const o = (when - t0) % dur
  return o < 0 ? o + dur : o
}

/** Primeiro início de loop >= now. */
export function nextLoopStart(now: number, t0: number, dur: number) {
  if (now <= t0) return t0
  return t0 + Math.ceil((now - t0) / dur) * dur
}

/** Frame do microfone onde está o som que o usuário tocou ouvindo o instante `time`. */
export const timeToFrame = (time: number, sampleRate: number, latency: number) =>
  Math.round((time + latency) * sampleRate)

/** Antes de t0 é a contagem (1 compasso começando em t0 - compasso). */
export function positionAt(time: number, t0: number, bpm: number, bars: number) {
  const bd = beatDuration(bpm)
  if (time < t0) {
    const beat = Math.floor((time - (t0 - BEATS_PER_BAR * bd)) / bd)
    return { phase: 0, beat: Math.min(BEATS_PER_BAR - 1, Math.max(0, beat)), countIn: true }
  }
  const dur = loopDuration(bpm, bars)
  const phase = loopOffset(time, t0, dur) / dur
  return { phase, beat: Math.min(bars * BEATS_PER_BAR - 1, Math.floor(phase * bars * BEATS_PER_BAR)), countIn: false }
}

/** Índice do tempo relativo a t0 (negativo na contagem); acento no 1º tempo do compasso. */
export const isAccent = (beatIndex: number) => ((beatIndex % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0

/** Latência total do recorte. latencyOffset positivo = recorte começa depois = áudio fica mais cedo no loop. */
export const captureLatency = (outputLatency: number, inputLatency: number, offsetMs: number) =>
  outputLatency + inputLatency + offsetMs / 1000

/** Instante que está sendo ouvido agora. */
export const heardTime = (currentTime: number, outputLatency: number) => currentTime - outputLatency

/**
 * Virada de loop onde a gravação pode começar: a captura só liga ao armar, então o frame
 * inicial (início + latency) precisa estar pelo menos `margin` no futuro e o início também.
 */
export const recordStart = (now: number, t0: number, dur: number, latency: number, margin = 0.05) =>
  nextLoopStart(now + Math.max(0, -latency) + margin, t0, dur)
