const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Instantes (s) de ataques: envelope |x| em janelas de 5 ms, limiar adaptativo e período refratário. */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  opts: { threshold?: number; minGapMs?: number } = {},
): number[] {
  const { threshold = 0.02, minGapMs = 120 } = opts
  const win = Math.max(1, Math.round(sampleRate * 0.005))
  const env: number[] = []
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += Math.abs(samples[j])
    env.push(sum / win)
  }
  if (!env.length) return []

  // mediana ≈ nível do ruído de fundo; ataque precisa ficar bem acima dela
  const thr = Math.max(threshold, 6 * median(env))
  const gap = (minGapMs / 1000) * sampleRate
  const onsets: number[] = []
  let last = -Infinity
  for (let f = 0; f < env.length; f++) {
    if (env[f] <= thr) continue
    // refina para o primeiro sample acima do limiar (a partir da janela anterior)
    let s = Math.max(0, (f - 1) * win)
    while (s < (f + 1) * win && Math.abs(samples[s]) <= thr) s++
    if (s - last < gap) continue
    onsets.push(s / sampleRate)
    last = s
  }
  return onsets
}

/**
 * Atraso mediano clique→palma. offsetMs soma ao latencyOffset do motor (positivo = gravação atrasada).
 * null se menos da metade dos cliques tiver palma correspondente.
 */
export function estimateLatency(
  clickTimes: number[],
  onsetTimes: number[],
  opts: { maxLagMs?: number } = {},
): { offsetMs: number; matched: number; jitterMs: number } | null {
  const maxLag = (opts.maxLagMs ?? 350) / 1000
  const lags: number[] = []
  for (const c of clickTimes) {
    const o = onsetTimes.find((t) => t >= c - 0.05 && t <= c + maxLag)
    if (o !== undefined) lags.push((o - c) * 1000)
  }
  if (!lags.length || lags.length < clickTimes.length / 2) return null
  const m = median(lags)
  return {
    offsetMs: Math.max(-200, Math.min(200, m)),
    matched: lags.length,
    jitterMs: median(lags.map((l) => Math.abs(l - m))),
  }
}
