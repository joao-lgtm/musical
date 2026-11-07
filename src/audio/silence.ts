export function isSilent(samples: Float32Array, thresholdDb = -50): boolean {
  const threshold = 10 ** (thresholdDb / 20)
  for (const sample of samples) {
    if (Math.abs(sample) >= threshold) return false
  }
  return true
}
