// Matemática pura de tempo e mixagem (segundos no relógio do AudioContext).

import { STEPS_PER_BAR } from './types'

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
    return { phase: 0, beat: Math.min(BEATS_PER_BAR - 1, Math.max(0, beat)), step: 0, countIn: true }
  }
  const dur = loopDuration(bpm, bars)
  const phase = loopOffset(time, t0, dur) / dur
  const steps = bars * STEPS_PER_BAR
  return {
    phase,
    beat: Math.min(bars * BEATS_PER_BAR - 1, Math.floor(phase * bars * BEATS_PER_BAR)),
    step: Math.min(steps - 1, Math.floor(phase * steps)),
    countIn: false,
  }
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

/** Semicolcheia. */
export const stepDuration = (bpm: number) => beatDuration(bpm) / 4

/** Delay em colcheia pontuada. */
export const delayTime = (bpm: number) => 0.75 * beatDuration(bpm)

/** Offset de start de um take com nudge (s; positivo = toca mais tarde). */
export const nudgedOffset = (when: number, t0: number, dur: number, nudge: number) => loopOffset(when - nudge, t0, dur)

/** Corte do passa-baixa: 0 → 200 Hz, 1 → 20 kHz, exponencial. */
export const filterFreq = (f: number) => 200 * Math.pow(100, f)

/** Pico linear → 0..1 para VU (escala em dB, -48..0). */
export function vuLevel(peak: number) {
  if (peak <= 0) return 0
  return Math.min(1, Math.max(0, (20 * Math.log10(peak) + 48) / 48))
}

/** Redimensiona cada voz para `steps` passos: repete os compassos existentes ou corta. */
export const resizePattern = (pattern: readonly (readonly boolean[])[], steps: number) =>
  pattern.map((row) => Array.from({ length: steps }, (_, k) => (row.length ? !!row[k % row.length] : false)))

/** Reamostragem linear para `len` amostras. */
export function resample(src: Float32Array, len: number) {
  if (src.length === len) return src
  const out = new Float32Array(len)
  const r = src.length / len
  for (let j = 0; j < len; j++) {
    const x = j * r
    const k = Math.floor(x)
    const a = src[k] ?? 0
    const b = src[k + 1] ?? src[src.length - 1] ?? 0
    out[j] = a + (b - a) * (x - k)
  }
  return out
}

/**
 * Overdub: soma ao take uma camada gravada no tempo do loop. A amostra j do take toca no
 * instante j + shift do loop (shift = nudge em amostras), então a camada é lida deslocada.
 */
export function overdubMix(take: Float32Array, layer: Float32Array, shift: number) {
  const len = take.length
  const l = resample(layer, len)
  const out = new Float32Array(len)
  for (let j = 0; j < len; j++) out[j] = take[j] + l[(((j + shift) % len) + len) % len]
  return out
}

/**
 * Calibração: 1 compasso de silêncio, depois `clicks` cliques em semínima.
 * Janela de captura começa `lead` antes do 1º clique e termina `tail` após o último.
 */
export function calibrationPlan(now: number, bpm: number, clicks: number, lead = 0.3, tail = 0.5) {
  const bd = beatDuration(bpm)
  const first = now + 0.1 + BEATS_PER_BAR * bd
  const clickTimes = Array.from({ length: clicks }, (_, k) => first + k * bd)
  return { clickTimes, start: first - lead, end: first + (clicks - 1) * bd + tail }
}
