// Contrato entre o motor de áudio e a interface. Mudanças aqui afetam os dois lados.

/**
 * empty: sem áudio. armed: aguardando o início do loop para gravar.
 * recording: gravando. recorded: tem áudio (soa enquanto o transporte toca).
 * Gravar (substituir) numa faixa 'recorded' descarta o take antigo ao armar; cancelar deixa 'empty'.
 * Overdub numa faixa 'recorded' soma a nova camada ao take; cancelar mantém o take.
 * Canal de bateria: 'recorded' se o padrão tem algum passo ligado, senão 'empty'.
 */
export type TrackStatus = 'empty' | 'armed' | 'recording' | 'recorded'

/** mic: gravado pelo microfone. drums: bateria sintetizada pelo sequenciador (último canal). */
export type TrackKind = 'mic' | 'drums'

/** De onde vem o som de um canal 'mic': microfone ou instrumento sintetizado tocado pelos pads (grava pelo mesmo fluxo de take). */
export type TrackSource = 'mic' | 'ocarina'

/** Tom do projeto; os instrumentos usam a pentatônica maior desse tom (ver scale.ts). */
export type Key = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B'
export const KEYS: readonly Key[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Pads de nota por instrumento (graus 0..7 da pentatônica a partir da tônica). */
export const NOTE_PADS = 8

export interface TrackState {
  readonly kind: TrackKind
  /** Nome exibido (editável, até 24 caracteres). Padrão: 'Faixa N' / 'Bateria'. */
  readonly name: string
  readonly status: TrackStatus
  readonly volume: number // 0..1
  readonly muted: boolean
  readonly solo: boolean // algum solo ligado → só canais em solo soam
  readonly pan: number // -1 (esq.)..1 (dir.)
  readonly filter: number // 0..1; 1 = aberto, 0 = passa-baixa fechado (~200 Hz)
  readonly delay: number // 0..1, envio para o delay sincronizado (colcheia pontuada)
  readonly reverb: number // 0..1, envio para o reverb
  /** ms, -100..100. Desloca o take no tempo (positivo = toca mais tarde). Só canais mic. */
  readonly nudge: number
  /** Só canais mic: se o próximo record sincroniza com overdub (true) ou substitui (false). */
  readonly overdubbing: boolean
  /** Só canais mic. 'mic' por padrão; com instrumento, gravar NÃO pede microfone e o take não usa a latência de entrada nem latencyOffset. */
  readonly source: TrackSource
  /** Há um estado anterior (1 nível) para undo(track). */
  readonly canUndo: boolean
  /** true quando o último take/overdub do canal mic foi descartado por estar mudo; volta a false ao armar, limpar, desfazer ou importar */
  readonly silentTake: boolean
  /** Incrementa sempre que o áudio/padrão do canal muda (take, overdub, undo, import) — gatilho para reler picos. */
  readonly revision: number
}

/** Resultado da calibração: offsetMs já aplicado em latencyOffset. */
export interface CalibrationResult {
  offsetMs: number
  matched: number // palmas reconhecidas
  total: number // cliques tocados
  jitterMs: number
}

export type DrumVoice = 'kick' | 'snare' | 'hat' | 'clap'
export const DRUM_VOICES: readonly DrumVoice[] = ['kick', 'snare', 'hat', 'clap']
/** 16 passos (semicolcheias) por compasso. */
export const STEPS_PER_BAR = 16

/** idle: antes de init. ready: pronto. error: ver `error` (mic negado/desconectado etc.). disposed: após dispose. */
export type EngineStatus = 'idle' | 'initializing' | 'ready' | 'error' | 'disposed'

/**
 * off: ainda não pedido. requesting: aguardando a permissão do navegador. ready: capturando.
 * denied: permissão negada (NotAllowedError). missing: sem dispositivo, ocupado ou desconectado.
 * Erro de microfone NÃO muda EngineStatus: bateria, sequenciador e play continuam funcionando.
 */
export type MicStatus = 'off' | 'requesting' | 'ready' | 'denied' | 'missing'

/**
 * Snapshot imutável: o mesmo objeto é retornado por getState até haver mudança,
 * e cada mudança gera um objeto novo (requisito de useSyncExternalStore).
 */
export interface EngineState {
  readonly status: EngineStatus
  readonly error: string | null
  readonly mic: MicStatus
  /** Mensagem técnica do último erro de microfone; a UI escolhe o texto pelo valor de `mic`. */
  readonly micError: string | null
  /** Canal mic que pediu o microfone e será armado quando ele for concedido; mantido em denied/missing para o erro inline. null sem pedido pendente. */
  readonly micTrack: number | null
  readonly bpm: number // 60..180
  readonly bars: 1 | 2 | 4
  readonly metronome: boolean
  /** ms, -200..200. Positivo = o áudio gravado é deslocado para mais cedo (compensa mais latência). Só afeta gravações futuras. */
  readonly latencyOffset: number
  readonly playing: boolean
  readonly loopDuration: number // segundos
  readonly masterVolume: number // 0..1
  readonly key: Key // padrão 'C'
  /** Enquanto um canal mic está armado/gravando, só ele (e metrônomo/contagem) soa na monitoração; os outros canais e a bateria ficam mudos. Não afeta renderMix/exportação. */
  readonly isolateRecording: boolean
  /** Há uma faixa removida que restoreTrack() pode recolocar (1 nível). */
  readonly canRestoreTrack: boolean
  /** 8 canais mic + 1 canal drums no fim (índice tracks.length - 1). */
  readonly tracks: readonly TrackState[]
  /** pattern[voz][passo], voz na ordem de DRUM_VOICES, bars * STEPS_PER_BAR passos. */
  readonly pattern: readonly (readonly boolean[])[]
}

/** Posição do que está sendo OUVIDO (currentTime - latência de saída), não do relógio agendado. */
export interface Position {
  playing: boolean
  phase: number // 0..1 dentro do loop
  beat: number // 0..(bars*4-1)
  step: number // 0..(bars*STEPS_PER_BAR-1), para o playhead do sequenciador
  countIn: boolean
}

/** Configuração editável de um canal (tudo de TrackState menos kind/status). */
export type TrackParams = Pick<TrackState, 'name' | 'volume' | 'muted' | 'solo' | 'pan' | 'filter' | 'delay' | 'reverb' | 'nudge' | 'overdubbing' | 'source'>

/** Projeto serializável (IndexedDB). Áudio mono por canal mic; null = vazio. */
export interface ProjectData {
  version: 1
  bpm: number
  bars: 1 | 2 | 4
  masterVolume: number
  /** Ausente em projetos antigos → 'C'. */
  key?: Key
  sampleRate: number
  /** `source` ausente em projetos antigos → 'mic'. */
  tracks: (Omit<TrackParams, 'source'> & { source?: TrackSource; audio: Float32Array | null })[]
  pattern: boolean[][]
}

/** Comandos chamados com status diferente de 'ready' são ignorados (exceto init/dispose). */
export interface LoopEngine {
  /** Cria AudioContext, mix, bateria e scheduler, SEM microfone. Chamar num gesto do usuário. Idempotente: chamadas concorrentes recebem a mesma Promise. Rejeita e põe status 'error' em falha. */
  init(): Promise<void>
  /** Pede o microfone (chamar num gesto do usuário). Idempotente: chamadas concorrentes recebem a mesma Promise. Resolve true se mic === 'ready'; nunca rejeita. */
  ensureMic(): Promise<boolean>
  /** Para tudo, fecha AudioContext e libera o microfone. Status vira 'disposed'. */
  dispose(): void
  /** Retorna false se já houver canal mic não vazio (BPM/compassos travam). O padrão de bateria não trava. */
  setBpm(bpm: number): boolean
  /** Ao mudar, o padrão é redimensionado (repete os compassos existentes ou corta). */
  setBars(bars: 1 | 2 | 4): boolean
  setMetronome(on: boolean): void
  setLatencyOffset(ms: number): void
  /**
   * Assistente "bata palma no clique": para o transporte, toca `clicks` cliques (default 8) no BPM atual,
   * grava o mic e estima a latência. Sucesso → aplica latencyOffset e resolve; palmas insuficientes → null.
   * `onClick(i)` é chamado no instante audível de cada clique (para a UI acender bolinhas).
   */
  calibrateLatency(opts?: { clicks?: number; onClick?: (i: number) => void }): Promise<CalibrationResult | null>
  /** Desfaz a última ação destrutiva do canal (gravar/overdub/apagar; drums: mudança de padrão). 1 nível. */
  undo(track: number): void
  setMasterVolume(volume: number): void
  play(): void
  stop(): void
  /**
   * Arma o canal mic (substitui ou overdub conforme `overdubbing`); chamar de novo enquanto armado/gravando cancela. Ignorado no canal drums.
   * Sem microfone (mic !== 'ready'): guarda micTrack, chama ensureMic e só arma após a permissão (antes, o take sairia vazio).
   * Chamar de novo durante 'requesting' cancela a intenção; em denied/missing, tenta de novo.
   */
  record(track: number): void
  /** Canal mic: apaga o take. Canal drums: limpa o padrão. */
  clear(track: number): void
  clearAll(): void
  /**
   * Remove o canal mic da mesa: as faixas seguintes sobem uma posição (áudio, parâmetros, undo, source) e o último canal mic vira vazio padrão.
   * Nomes padrão ('Faixa N') são renumerados; nomes editados são mantidos. Ignorado em canal armado/gravando, durante a calibração ou no drums.
   */
  removeTrack(track: number): void
  /** Recoloca a última faixa removida na posição original (empurrando as seguintes). Ignorado se canRestoreTrack for false ou houver gravação em curso. */
  restoreTrack(): void
  setIsolateRecording(on: boolean): void
  /** Atualiza parâmetros do canal (merge parcial). Valores fora da faixa são limitados. */
  setTrack(track: number, params: Partial<TrackParams>): void
  /** skipNext: ao inserir via pad ao vivo, pula apenas a ocorrência quantizada ainda não processada pelo scheduler; as próximas voltas tocam normalmente. */
  /** Muda o tom (afeta pads e takes futuros; takes já gravados não mudam). */
  setKey(key: Key): void
  /**
   * Toca/solta uma nota do instrumento do canal (grau 0..NOTE_PADS-1 da pentatônica de state.key, a partir da 4ª oitava).
   * Ignorado se o canal não tiver source de instrumento. Soa ao vivo e, se o canal estiver 'recording', entra no take.
   * Polifônico até 4 vozes por canal (a mais antiga é cortada com rampa). noteOff sem noteOn é ignorado.
   */
  noteOn(track: number, degree: number): void
  noteOff(track: number, degree: number): void
  toggleStep(voice: number, step: number, opts?: { skipNext?: boolean }): void
  /** Substitui o padrão inteiro numa única notificação; redimensionado para bars*STEPS_PER_BAR (repete ou corta). */
  setPattern(pattern: boolean[][]): void
  /** Toca uma voz da bateria agora (pads ao vivo / prévia). */
  triggerDrum(voice: DrumVoice): void
  /** Leitura barata, para requestAnimationFrame. */
  getPosition(): Position
  getPeaks(track: number, n: number): Float32Array | null
  /** Cópia mono do take do canal mic (para transcrever/detectar offline); null se vazio, armado ou gravando. */
  getTakeAudio(track: number): { samples: Float32Array; sampleRate: number } | null
  /**
   * Substitui o take do canal mic por áudio gerado (ex.: voz → ocarina), ajustado ao comprimento do loop (corta ou completa com silêncio).
   * Desfazível como uma regravação (undo restaura o take e o source anteriores). Opcionalmente troca o source do canal.
   * Ignorado em canal armado/gravando, durante a calibração ou no canal drums.
   */
  applyTake(track: number, samples: Float32Array, opts?: { sampleRate?: number; source?: TrackSource }): void
  /** Segundos (no relógio ouvido) até a gravação do canal armado começar de fato; null se não armado. Para rAF. */
  getArmedIn(track: number): number | null
  /** Nível atual 0..1 já em escala de meter (pico em dB, -48..0 dB → 0..1) por canal (tracks.length valores) + master no fim, para VU meters. */
  getLevels(): Float32Array
  /** Nível de entrada do microfone 0..1, na mesma escala de getLevels; 0 se mic !== 'ready'. Para rAF. */
  getInputLevel(): number
  /** Mixagem final em tempo real, para gravar vídeo com áudio (MediaRecorder). */
  getOutputStream(): MediaStream | null
  /** Renderiza `loops` repetições do loop com a mixagem atual (inclui FX e bateria; sem metrônomo). */
  renderMix(loops: number): Promise<AudioBuffer>
  exportProject(): ProjectData
  /** Para o transporte e substitui tudo pelo projeto. */
  importProject(data: ProjectData): void
  getState(): EngineState
  /** Retorna função para cancelar a inscrição. */
  subscribe(fn: (state: EngineState) => void): () => void
}
