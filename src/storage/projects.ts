import type { ProjectData } from '../audio/types'

// 'meta' guarda só nome/data (listagem barata); 'data' guarda o projeto com áudio
type Meta = { id: string; name: string; updatedAt: number }

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('loop-studio', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('meta', { keyPath: 'id' })
      req.result.createObjectStore('data')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

/** Abre transação nos dois stores e resolve com `result` quando ela completa. */
async function tx<T>(mode: IDBTransactionMode, fn: (meta: IDBObjectStore, data: IDBObjectStore) => () => T): Promise<T> {
  const t = (await db()).transaction(['meta', 'data'], mode)
  const result = fn(t.objectStore('meta'), t.objectStore('data'))
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result())
    t.onerror = t.onabort = () => reject(t.error)
  })
}

export function saveProject(name: string, data: ProjectData, id: string = crypto.randomUUID()): Promise<string> {
  return tx('readwrite', (meta, store) => {
    meta.put({ id, name, updatedAt: Date.now() } satisfies Meta)
    store.put(data, id)
    return () => id
  })
}

export async function listProjects(): Promise<Meta[]> {
  const all = await tx('readonly', (meta) => {
    const req = meta.getAll()
    return () => req.result as Meta[]
  })
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadProject(id: string): Promise<ProjectData | null> {
  return tx('readonly', (_, store) => {
    const req = store.get(id)
    return () => (req.result as ProjectData | undefined) ?? null
  })
}

export function deleteProject(id: string): Promise<void> {
  return tx('readwrite', (meta, store) => {
    meta.delete(id)
    store.delete(id)
    return () => undefined
  })
}


async function draftTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<T> {
  const t = (await db()).transaction('data', mode)
  const result = fn(t.objectStore('data'))
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result())
    t.onerror = t.onabort = () => reject(t.error)
  })
}

export function saveDraft(data: ProjectData): Promise<void> {
  return draftTx('readwrite', (store) => {
    store.put(data, '__draft__')
    return () => undefined
  })
}

export function loadDraft(): Promise<ProjectData | null> {
  return draftTx('readonly', (store) => {
    const req = store.get('__draft__')
    return () => (req.result as ProjectData | undefined) ?? null
  })
}

export function clearDraft(): Promise<void> {
  return draftTx('readwrite', (store) => {
    store.delete('__draft__')
    return () => undefined
  })
}
