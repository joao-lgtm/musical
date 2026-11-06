// Roda no AudioWorkletGlobalScope: envia blocos mono com o frame da 1ª amostra.

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void
declare const currentFrame: number

class Recorder extends AudioWorkletProcessor {
  on = false
  constructor() {
    super()
    this.port.onmessage = (e) => (this.on = e.data)
  }
  process(inputs: Float32Array[][]) {
    const ch = inputs[0]?.[0]
    if (this.on && ch?.length) this.port.postMessage({ frame: currentFrame, data: ch.slice() })
    return true
  }
}

registerProcessor('recorder', Recorder)
