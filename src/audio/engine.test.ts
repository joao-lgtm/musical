import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'

describe('nomes das faixas', () => {
  it('inclui os nomes padrão no estado e nos projetos exportados', () => {
    const engine = createEngine({ tracks: 2 })
    expect(engine.getState().tracks.map((t) => t.name)).toEqual(['Faixa 1', 'Faixa 2', 'Bateria'])
    expect(engine.exportProject().tracks.map((t) => t.name)).toEqual(['Faixa 1', 'Faixa 2', 'Bateria'])
    engine.dispose()
  })
})
