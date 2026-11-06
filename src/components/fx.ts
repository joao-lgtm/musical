// Knobs de efeito por canal (mic e bateria)
const pct = (v: number) => `${Math.round(v * 100)}%`

export const FX_KNOBS = [
  {
    param: 'pan', label: 'Pan', min: -1, max: 1, step: 0.02, defaultValue: 0, bipolar: true,
    format: (v: number) => (Math.abs(v) < 0.01 ? 'C' : `${v < 0 ? 'E' : 'D'}${Math.round(Math.abs(v) * 100)}`),
  },
  {
    param: 'filter', label: 'Filtro', min: 0, max: 1, step: 0.01, defaultValue: 1,
    // 0..1 → ~200 Hz..aberto (escala exponencial só para leitura)
    format: (v: number) => {
      const f = 200 * Math.pow(100, v)
      return v >= 0.99 ? 'Aberto' : f < 1000 ? `${Math.round(f)} Hz` : `${(f / 1000).toFixed(1)} k`
    },
  },
  { param: 'delay', label: 'Delay', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
  { param: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01, defaultValue: 0, format: pct },
] as const
