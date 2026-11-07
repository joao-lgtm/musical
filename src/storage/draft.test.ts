import { describe, expect, it } from 'vitest'
import type { EngineState, TrackState } from '../audio/types'
import { createDraftProgress, draftWriteAction, hasDraftContentChanged, isDraftEmpty, observeDraft } from './draft'

function state(): EngineState {
  return {
    status: 'ready', error: null, mic: 'off', micError: null, micTrack: null,
    bpm: 120, bars: 1, metronome: false, latencyOffset: 0, playing: false,
    loopDuration: 2, masterVolume: 1, key: 'C', scale: 'pentatonic',
    isolateRecording: false, canRestoreTrack: false, canUndoBatch: false, liveDrums: true,
    pattern: Array.from({ length: 4 }, () => Array<boolean>(16).fill(false)),
    tracks: [{
      kind: 'mic', name: 'Faixa 1', status: 'empty', volume: 1, muted: false,
      solo: false, pan: 0, filter: 1, delay: 0, reverb: 0, nudge: 0,
      overdubbing: false, source: 'mic', padMode: 'notes', notes: null, canUndo: false, silentTake: false, revision: 0,
    }],
  }
}

function trackChange(base: EngineState, patch: Partial<TrackState>): EngineState {
  return { ...base, tracks: [{ ...base.tracks[0], ...patch }] }
}

describe('hasDraftContentChanged', () => {
  it('ignora identidade e estados operacionais', () => {
    const base = state()
    const next: EngineState = {
      ...state(), status: 'error', error: 'erro', playing: true, mic: 'denied',
      micError: 'erro', micTrack: 0, metronome: true, latencyOffset: 30, loopDuration: 4,
    }
    expect(hasDraftContentChanged(base, next)).toBe(false)
    for (const status of ['armed', 'recording', 'recorded'] as const) {
      expect(hasDraftContentChanged(base, trackChange(base, {
        status, canUndo: true, silentTake: true,
      }))).toBe(false)
    }
  })

  it('ignora isolamento de gravacao e disponibilidade de restauracao', () => {
    const base = state()
    for (const patch of [
      { isolateRecording: true }, { canRestoreTrack: true },
      { isolateRecording: true, canRestoreTrack: true },
    ]) {
      expect(hasDraftContentChanged(base, { ...base, ...patch })).toBe(false)
    }
  })

  it('ignora undo em lote e preferencia de bateria viva', () => {
    const base = state()
    for (const patch of [
      { canUndoBatch: true }, { liveDrums: false },
      { canUndoBatch: true, liveDrums: false },
    ]) {
      const next = { ...base, ...patch }
      expect(hasDraftContentChanged(base, next)).toBe(false)
      expect(observeDraft(createDraftProgress(base), next).dirty).toBe(false)
    }
  })

  it('detecta mudanca do tom do projeto', () => {
    const base = state()
    expect(hasDraftContentChanged(base, { ...base, key: 'D' })).toBe(true)
  })

  it('detecta mudanca de escala sem mudar o tom', () => {
    const base = state()
    const major = { ...base, scale: 'major' as const }
    expect(hasDraftContentChanged(base, major)).toBe(true)
    expect(hasDraftContentChanged(major, base)).toBe(true)
    expect(hasDraftContentChanged(base, { ...base })).toBe(false)
  })

  it('detecta revision mesmo sem mudar os params', () => {
    const base = state()
    expect(hasDraftContentChanged(base, trackChange(base, { revision: 1 }))).toBe(true)
  })

  it('compara notas genericamente sem depender de revision', () => {
    const base = state()
    const note = { step: 2, length: 4, midi: 60 }
    const withNotes = trackChange(base, { notes: [note] })
    expect(hasDraftContentChanged(base, withNotes)).toBe(true)
    expect(hasDraftContentChanged(withNotes, base)).toBe(true)
    expect(hasDraftContentChanged(withNotes, trackChange(base, { notes: [{ ...note }] }))).toBe(false)
    for (const patch of [{ step: 3 }, { length: 2 }, { midi: 62 }]) {
      const next = trackChange(base, { notes: [{ ...note, ...patch }] })
      expect(hasDraftContentChanged(withNotes, next)).toBe(true)
      expect(observeDraft(createDraftProgress(withNotes), next).dirty).toBe(true)
    }
    expect(hasDraftContentChanged(withNotes, trackChange(base, { notes: [] }))).toBe(true)
    expect(hasDraftContentChanged(withNotes, trackChange(base, { notes: [note, { ...note, step: 8 }] }))).toBe(true)
  })

  it('detecta padMode pela comparacao generica sem mudar revision', () => {
    const base = state()
    const chords = trackChange(base, { padMode: 'chords' })
    expect(hasDraftContentChanged(base, chords)).toBe(true)
    expect(hasDraftContentChanged(chords, base)).toBe(true)
    expect(observeDraft(createDraftProgress(base), chords).dirty).toBe(true)
    expect(hasDraftContentChanged(base, trackChange(base, { padMode: 'notes' }))).toBe(false)
  })

  it('detecta todos os params atuais', () => {
    const base = state()
    const changes: Partial<TrackState>[] = [
      { name: 'Nova' }, { volume: 0.5 }, { muted: true }, { solo: true },
      { pan: 0.5 }, { filter: 0.5 }, { delay: 0.5 }, { reverb: 0.5 },
      { nudge: 20 }, { overdubbing: true },
    ]
    for (const patch of changes) {
      expect(hasDraftContentChanged(base, trackChange(base, patch))).toBe(true)
    }
  })

  it('compara campos futuros genericamente, inclusive objetos e ordem de chaves', () => {
    const base = state()
    const withSource = (source: unknown): EngineState => ({
      ...base, tracks: [{ ...base.tracks[0], source } as TrackState],
    })
    expect(hasDraftContentChanged(base, withSource('sample'))).toBe(true)
    expect(hasDraftContentChanged(withSource('mic'), withSource('sample'))).toBe(true)
    expect(hasDraftContentChanged(withSource({ a: 1, b: 2 }), withSource({ b: 2, a: 1 }))).toBe(false)
  })

  it('detecta controles globais, pattern e quantidade de faixas', () => {
    const base = state()
    for (const patch of [{ bpm: 130 }, { bars: 2 as const }, { masterVolume: 0.5 }]) {
      expect(hasDraftContentChanged(base, { ...base, ...patch })).toBe(true)
    }
    const next = state()
    ;(next.pattern[0] as boolean[])[3] = true
    expect(hasDraftContentChanged(base, next)).toBe(true)
    expect(hasDraftContentChanged(base, { ...base, tracks: [] })).toBe(true)
  })
})

describe('isDraftEmpty', () => {
  it('ignora params e revision quando nao ha takes nem passos', () => {
    expect(isDraftEmpty(trackChange(state(), { revision: 5, volume: 0.2 }))).toBe(true)
  })

  it('reconhece um take mesmo mutado ou com volume zero', () => {
    expect(isDraftEmpty(trackChange(state(), { status: 'recorded', muted: true, volume: 0 }))).toBe(false)
  })

  it('reconhece qualquer passo de bateria independentemente do status', () => {
    const next = state()
    ;(next.pattern[3] as boolean[])[15] = true
    expect(isDraftEmpty(next)).toBe(false)
  })

  it('nao confunde o status da bateria com um take de microfone', () => {
    expect(isDraftEmpty(trackChange(state(), { kind: 'drums', status: 'recorded' }))).toBe(true)
  })
})


describe('decisoes de escrita do autosave', () => {
  it('apaga o rascunho ao limpar um take, mesmo depois de um save concluido', () => {
    const recorded = trackChange(state(), { status: 'recorded', revision: 1 })
    const saved = createDraftProgress(recorded)
    const cleared = observeDraft(saved, trackChange(recorded, { status: 'empty', revision: 2 }))
    expect(saved.dirty).toBe(false)
    expect(cleared.hadContent).toBe(true)
    expect(draftWriteAction(cleared)).toBe('clear')
  })

  it('apaga ao limpar a bateria mesmo que ela nunca tenha chegado ao debounce', () => {
    const initial = state()
    const drums = { ...initial, pattern: [[true]] }
    let progress = observeDraft(createDraftProgress(initial), drums)
    expect(draftWriteAction(progress)).toBe('save')
    progress = observeDraft(progress, initial)
    expect(draftWriteAction(progress)).toBe('clear')
  })

  it('preserva o rascunho anterior ao comecar do zero e mudar apenas params', () => {
    const initial = state()
    const progress = observeDraft(createDraftProgress(initial), { ...initial, bpm: 140 })
    expect(progress.dirty).toBe(true)
    expect(progress.hadContent).toBe(false)
    expect(draftWriteAction(progress)).toBe('preserve')
  })

  it('decide salvar o snapshot completo ao desabilitar com dirty e sem captura', () => {
    const recorded = trackChange(state(), { status: 'recorded', revision: 1 })
    let progress = observeDraft(createDraftProgress(recorded), { ...recorded, masterVolume: 0.5 })
    progress = observeDraft(progress, { ...progress.previous, status: 'error' })
    expect(draftWriteAction(progress)).toBe('save')
    expect(progress.previous.masterVolume).toBe(0.5)
    expect(progress.dirty).toBe(true)
  })

  it.each(['armed', 'recording'] as const)('mantem dirty ao desabilitar durante %s e salva ao reativar', status => {
    const recorded = trackChange(state(), { status: 'recorded', revision: 1 })
    let progress = observeDraft(createDraftProgress(recorded), { ...recorded, bpm: 130 })
    const capture = trackChange(progress.previous, { status })
    progress = observeDraft(progress, capture)
    expect(draftWriteAction(progress)).toBe('defer')
    expect(progress.dirty).toBe(true)
    progress = observeDraft(progress, capture)
    expect(draftWriteAction(progress)).toBe('defer')
    const complete = trackChange(capture, { status: 'recorded', revision: 2 })
    progress = observeDraft(progress, complete)
    expect(draftWriteAction(progress)).toBe('save')
    expect(progress.previous).toBe(complete)
    expect(progress.previous.bpm).toBe(130)
  })

  it('observa o take concluido enquanto estava desabilitado mesmo sem dirty previo', () => {
    const initial = state()
    let progress = observeDraft(createDraftProgress(initial), trackChange(initial, { status: 'recording' }))
    expect(draftWriteAction(progress)).toBe('none')
    progress = observeDraft(progress, trackChange(initial, { status: 'recorded', revision: 1 }))
    expect(draftWriteAction(progress)).toBe('save')
  })

  it('adia tambem clear enquanto outra faixa esta gravando', () => {
    const recorded = trackChange(state(), { status: 'recorded', revision: 1 })
    let progress = observeDraft(createDraftProgress(recorded), trackChange(recorded, { status: 'recording', revision: 2 }))
    expect(draftWriteAction(progress)).toBe('defer')
    progress = observeDraft(progress, trackChange(recorded, { status: 'empty', revision: 3 }))
    expect(draftWriteAction(progress)).toBe('clear')
  })

  it('nao escreve novamente ao reativar depois de consumir o dirty', () => {
    const recorded = trackChange(state(), { status: 'recorded', revision: 1 })
    const pending = observeDraft(createDraftProgress(recorded), { ...recorded, bars: 2 })
    expect(draftWriteAction(pending)).toBe('save')
    const flushed = { ...pending, dirty: false }
    expect(draftWriteAction(observeDraft(flushed, flushed.previous))).toBe('none')
    expect(pending.dirty).toBe(true)
  })
})
