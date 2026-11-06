// Presets de 1 compasso (16 semicolcheias). 'x' = passo ligado. Ordem: bumbo, caixa, chimbal, palmas.
export interface DrumPreset {
  name: string
  rows: [string, string, string, string]
}

export const DRUM_PRESETS: readonly DrumPreset[] = [
  { name: 'Pop', rows: ['x.......x.x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '............x...'] },
  { name: 'Funk', rows: ['x.x...x...x..x..', '....x..x.x..x...', 'xxxxxxxxxxxxxxxx', '................'] },
  { name: 'Boom bap', rows: ['x......x..x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '....x.......x...'] },
  { name: 'Reggaeton', rows: ['x...x...x...x...', '...x..x....x..x.', '..x...x...x...x.', '................'] },
  { name: 'House', rows: ['x...x...x...x...', '................', '..x...x...x...x.', '....x.......x...'] },
]

/** Básico de demonstração: bumbo 1 e 3, caixa 2 e 4, chimbal em colcheias. */
export const DEMO_PRESET: DrumPreset = {
  name: 'Básico',
  rows: ['x.......x.......', '....x.......x...', 'x.x.x.x.x.x.x.x.', '................'],
}

export const toPattern = (p: DrumPreset) => p.rows.map((r) => [...r].map((c) => c === 'x'))
