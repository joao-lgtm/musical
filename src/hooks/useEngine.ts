import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createEngine } from '../audio/engine'
import type { LoopEngine, Position } from '../audio/types'

export const EngineContext = createContext<LoopEngine | null>(null)

export function useEngine() {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine fora de <EngineContext>')
  return engine
}

/**
 * Uma instância por montagem do App; init() só roda no gesto do usuário.
 * O StrictMode desmonta/remonta em seguida: o dispose é adiado e cancelado se remontar.
 * Remontagem real cria outra instância (useState lazy roda de novo).
 */
export function useOwnEngine() {
  const [engine] = useState(() => createEngine())
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(pending.current) // remontagem do StrictMode: cancela o dispose agendado
    return () => {
      pending.current = setTimeout(() => engine.dispose())
    }
  }, [engine])
  return engine
}

export function useEngineState(engine: LoopEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

// ---- um único requestAnimationFrame para a página toda ----
const callbacks = new Set<() => void>()
let rafId = 0
let frameNo = 0
function loop() {
  frameNo++
  callbacks.forEach((f) => f())
  rafId = callbacks.size ? requestAnimationFrame(loop) : 0
}

/** Chama fn a cada frame no loop compartilhado, sem re-render. */
export function useFrame(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    const cb = () => ref.current()
    callbacks.add(cb)
    if (!rafId) rafId = requestAnimationFrame(loop)
    return () => {
      callbacks.delete(cb)
    }
  }, [])
}

/** Posição e níveis lidos uma vez por frame, compartilhados entre todos os componentes. */
const cache = new WeakMap<LoopEngine, { n: number; pos: Position; levels: Float32Array }>()
export function readFrame(engine: LoopEngine) {
  let c = cache.get(engine)
  if (!c || c.n !== frameNo) {
    c = { n: frameNo, pos: engine.getPosition(), levels: engine.getLevels() }
    cache.set(engine, c)
  }
  return c
}
