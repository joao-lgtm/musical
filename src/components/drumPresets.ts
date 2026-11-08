import type { KitId, LoopEngine } from '../audio/types'

// Presets de 1 compasso: 'x' liga o passo. O kit define a ordem das oito pecas.
export interface DrumPreset {
  name: string
  kit?: KitId
  rows: [string, string, string, string] | [string, string, string, string, string, string, string, string]
}

export const DRUM_PRESETS: readonly DrumPreset[] = [
  { name: 'Pagode', kit: 'roda', rows: [
    '....x.......x...', '..x...x...x...x.', 'xxxxxxxxxxxxxxxx', 'x..x..x.x..x..x.',
    'x.....x.x.....x.', '...x.......x....', 'x.x.x.x.x.x.x.x.', '....x.......x...',
  ] },
  { name: 'Samba', kit: 'roda', rows: [
    '....x.......x...', 'x..x..x.x..x..x.', 'xxxxxxxxxxxxxxxx', '..xx.x..x.xx.x..',
    '..x...x...x...x.', 'x..x..x...x..x..', '.x.x.x.x.x.x.x.x', '....x.......x...',
  ] },
  { name: 'Funk carioca', kit: '808', rows: [
    'x..x..x.x..x..x.', '....x.......x...', 'x.x.x.x.x.x.x.x.', '....x.......x...',
    '..............x.', 'x..x..x.x..x..x.', '................', '................',
  ] },
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

/** Sorteia um preset diferente de `lastName`, aplica no motor, toca se estiver parado e retorna o nome. */
export function surprise(engine: LoopEngine, lastName?: string): string {
  const pool = DRUM_PRESETS.filter((p) => p.name !== lastName)
  const pick = pool[Math.floor(Math.random() * pool.length)]
  engine.setPattern(toPattern(pick))
  if (!engine.getState().playing) engine.play()
  return pick.name
}
