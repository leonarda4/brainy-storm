// AudioContext supplies mono 24 kHz samples. Gradium expects signed 16-bit LE PCM.
class PCMRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (samples) {
      const buffer = new ArrayBuffer(samples.length * 2)
      const view = new DataView(buffer)
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      this.port.postMessage(buffer, [buffer])
    }
    // Output remains silent: microphone audio is never played through speakers.
    return true
  }
}
registerProcessor('pcm-recorder', PCMRecorder)
