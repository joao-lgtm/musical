import type { EngineState, TrackState } from '../audio/types'

function content(track: TrackState) {
  const { kind, status, canUndo, silentTake, ...params } = track
  return params
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.entries(a)
  const right = Object.entries(b)
  return left.length === right.length && left.every(([key, value]) =>
    Object.hasOwn(b, key) && equal(value, (b as Record<string, unknown>)[key]))
}

export function hasDraftContentChanged(previous: EngineState, next: EngineState): boolean {
  return previous.kit !== next.kit || previous.scale !== next.scale || previous.key !== next.key || previous.bpm !== next.bpm || previous.bars !== next.bars ||
    previous.masterVolume !== next.masterVolume || !equal(previous.pattern, next.pattern) ||
    !equal(previous.tracks.map(content), next.tracks.map(content))
}

export function isDraftEmpty(state: EngineState): boolean {
  return !state.tracks.some(track => track.kind === 'mic' && track.status === 'recorded') &&
    !state.pattern.some(voice => voice.some(Boolean))
}


export interface DraftProgress {
  previous: EngineState
  dirty: boolean
  hadContent: boolean
}

export function createDraftProgress(state: EngineState): DraftProgress {
  return { previous: state, dirty: false, hadContent: !isDraftEmpty(state) }
}

export function observeDraft(progress: DraftProgress, state: EngineState): DraftProgress {
  return {
    previous: state,
    dirty: progress.dirty || hasDraftContentChanged(progress.previous, state),
    hadContent: progress.hadContent || !isDraftEmpty(state),
  }
}

export function draftWriteAction(progress: DraftProgress): 'none' | 'defer' | 'preserve' | 'clear' | 'save' {
  if (!progress.dirty) return 'none'
  if (progress.previous.tracks.some(track => track.status === 'armed' || track.status === 'recording')) return 'defer'
  if (!isDraftEmpty(progress.previous)) return 'save'
  return progress.hadContent ? 'clear' : 'preserve'
}
