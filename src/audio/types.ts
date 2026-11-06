// Contrato entre o motor de áudio e a interface. Mudanças aqui afetam os dois lados.

/**
 * empty: sem áudio. armed: aguardando o início do loop para gravar.
 * recording: gravando. recorded: tem áudio (soa enquanto o transporte toca).
 * Gravar numa faixa 'recorded' descarta o take antigo ao armar (evita vazar no microfone);
 * cancelar (record de novo) deixa a faixa 'empty'.
 */
export type TrackStatus = 'empty' | 'armed' | 'recording' | 'recorded'

export interface TrackState {
  readonly status: TrackStatus
  readonly volume: number // 0..1
  readonly muted: boolean
}

/** idle: antes de init. ready: pronto. error: ver `error` (mic negado/desconectado etc.). disposed: após dispose. */
export type EngineStatus = 'idle' | 'initializing' | 'ready' | 'error' | 'disposed'

/**
 * Snapshot imutável: o mesmo objeto é retornado por getState até haver mudança,
 * e cada mudança gera um objeto novo (requisito de useSyncExternalStore).
 */
export interface EngineState {
  readonly status: EngineStatus
  readonly error: string | null
  readonly bpm: number // 60..180
  readonly bars: 1 | 2 | 4
  readonly metronome: boolean
  /** ms, -200..200. Positivo = o áudio gravado é deslocado para mais cedo (compensa mais latência). Só afeta gravações futuras. */
  readonly latencyOffset: number
  readonly playing: boolean
  readonly loopDuration: number // segundos
  readonly tracks: readonly TrackState[]
}

/** Posição do que está sendo OUVIDO (currentTime - outputLatency), não do relógio agendado. */
export interface Position {
  playing: boolean
  phase: number // 0..1 dentro do loop
  beat: number // 0..(bars*4-1)
  countIn: boolean
}

/** Comandos chamados com status diferente de 'ready' são ignorados (exceto init/dispose). */
export interface LoopEngine {
  /** Cria AudioContext e pede o microfone. Chamar num gesto do usuário. Idempotente: chamadas concorrentes recebem a mesma Promise. Rejeita e põe status 'error' em falha. */
  init(): Promise<void>
  /** Para tudo, fecha AudioContext e libera o microfone. Status vira 'disposed'. */
  dispose(): void
  /** Retorna false se já houver faixa não vazia (BPM/compassos travam). */
  setBpm(bpm: number): boolean
  setBars(bars: 1 | 2 | 4): boolean
  setMetronome(on: boolean): void
  setLatencyOffset(ms: number): void
  play(): void
  stop(): void
  /** Arma a faixa; chamar de novo enquanto armada/gravando cancela. */
  record(track: number): void
  clear(track: number): void
  clearAll(): void
  setVolume(track: number, volume: number): void
  setMute(track: number, muted: boolean): void
  /** Leitura barata, para requestAnimationFrame. */
  getPosition(): Position
  getPeaks(track: number, n: number): Float32Array | null
  getState(): EngineState
  /** Retorna função para cancelar a inscrição. */
  subscribe(fn: (state: EngineState) => void): () => void
}
