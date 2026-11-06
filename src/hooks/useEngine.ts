import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createEngine } from '../audio/engine'
import type { LoopEngine } from '../audio/types'

export const TRACKS = 4

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
  const [engine] = useState(() => createEngine({ tracks: TRACKS }))
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

/** Chama fn a cada frame (leituras baratas: posição, picos) sem re-render. */
export function useFrame(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    let id = 0
    const loop = () => {
      ref.current()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}
