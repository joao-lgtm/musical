import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createEngine } from '../audio/engine'

export const TRACKS = 4
// uma instância por página, criada fora do render; init() só roda no gesto do usuário
export const engine = createEngine({ tracks: TRACKS })

export function useEngineState() {
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

/**
 * Libera o motor só no unmount real. O StrictMode desmonta/remonta em seguida
 * de forma síncrona, então adiamos e conferimos se voltou a montar.
 */
let mounts = 0
export function useEngineLifetime() {
  useEffect(() => {
    mounts++
    return () => {
      mounts--
      setTimeout(() => mounts === 0 && engine.dispose())
    }
  }, [])
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
