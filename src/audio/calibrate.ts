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
 * Cada onset casa com no máximo um clique, e a janela não passa do próximo clique + 50 ms.
 * null se só metade ou menos dos cliques casar (ex.: palmas a cada 2 cliques em BPM alto
 * são ambíguas) ou se jitterMs > maxJitterMs (indica casamento errado).
 */
export function estimateLatency(
  clickTimes: number[],
  onsetTimes: number[],
  opts: { maxLagMs?: number; maxJitterMs?: number } = {},
): { offsetMs: number; matched: number; jitterMs: number } | null {
  const maxLag = (opts.maxLagMs ?? 350) / 1000
  const clicks = [...clickTimes].sort((a, b) => a - b)
  const onsets = [...onsetTimes].sort((a, b) => a - b)
  const lags: number[] = []
  let j = 0 // onsets antes de j já foram usados ou ficaram para trás
  clicks.forEach((c, k) => {
    const end = Math.min(c + maxLag, (clicks[k + 1] ?? Infinity) + 0.05)
    while (j < onsets.length && onsets[j] < c - 0.05) j++
    if (j < onsets.length && onsets[j] <= end) lags.push((onsets[j++] - c) * 1000)
  })
  if (!lags.length || lags.length <= clicks.length / 2) return null
  const m = median(lags)
  const jitterMs = median(lags.map((l) => Math.abs(l - m)))
  if (jitterMs > (opts.maxJitterMs ?? 25)) return null
  return { offsetMs: Math.max(-200, Math.min(200, m)), matched: lags.length, jitterMs }
}
