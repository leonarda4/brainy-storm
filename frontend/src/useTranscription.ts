import { useCallback, useEffect, useRef, useState } from 'react'
import { applySpeakers, parseTranscript, transcriptLine } from './transcript'
import type { TranscriptLine } from './transcript'
import { createStormVoice } from './stormVoice'
import type { StormTakeover } from './stormVoice'

export type { TranscriptLine } from './transcript'
type Status = 'stopped' | 'connecting' | 'recording' | 'paused' | 'saving'
const base = (import.meta.env.VITE_TRANSCRIBER_URL || '/api/transcriber').replace(/\/$/, '')
const sessionUrl = (path: string, sessionId: string) => `${base}${path}?session_id=${encodeURIComponent(sessionId)}`

export function useTranscription(sessionId: string) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [recording, setRecording] = useState<Status>('stopped')
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [speakerWarning, setSpeakerWarning] = useState('')
  const [stormWarning, setStormWarning] = useState('')
  const [storm, setStorm] = useState<StormTakeover | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const resources = useRef<{ stream?: MediaStream; context?: AudioContext; node?: AudioWorkletNode; socket?: WebSocket }>({})
  const busy = useRef(false)
  const mounted = useRef(true)
  const stopTarget = useRef<Status>('stopped')
  const restartingTranscript = useRef(false)
  const stopping = useRef(false)
  const historyRequest = useRef(0)
  const readyTimer = useRef<number | undefined>(undefined)
  const completionTimer = useRef<number | undefined>(undefined)
  const stormVoice = useRef<ReturnType<typeof createStormVoice> | undefined>(undefined)
  const stormMuted = useRef(false)
  const stormEvents = useRef(new Set<string>())
  const [historySession, setHistorySession] = useState(sessionId)

  function cancelStorm() {
    stormVoice.current?.cancel()
    stormMuted.current = false
  }

  function clearTimers() {
    window.clearTimeout(readyTimer.current)
    window.clearTimeout(completionTimer.current)
  }

  function releaseAudio() {
    cancelStorm()
    const r = resources.current
    if (r.node) { r.node.port.onmessage = null; r.node.disconnect() }
    r.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    if (r.context && r.context.state !== 'closed') void r.context.close().catch(() => {})
    r.node = undefined
    r.stream = undefined
    r.context = undefined
  }

  const readTranscript = useCallback(async (signal = AbortSignal.timeout(8000)) => {
    const response = await fetch(sessionUrl('/transcript', sessionId), { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`Could not load the saved transcript (HTTP ${response.status}).`)
    const data = await response.json() as { transcript: string }
    if (typeof data.transcript !== 'string') throw new Error('The transcript service returned an invalid response.')
    return data.transcript
  }, [sessionId])

  const loadTranscript = useCallback(async (signal?: AbortSignal) => {
    const request = ++historyRequest.current
    const text = await readTranscript(signal)
    if (!mounted.current || request !== historyRequest.current) return
    setTranscript(parseTranscript(text))
    setHistorySession(sessionId)
    setLoaded(true)
    setHistoryError('')
  }, [readTranscript, sessionId])

  function cleanupRecording() {
    ++historyRequest.current
    clearTimers()
    releaseAudio()
    const socket = resources.current.socket
    resources.current.socket = undefined
    if (socket?.readyState === WebSocket.OPEN && !stopping.current) socket.send(JSON.stringify({ action: 'stop' }))
    socket?.close()
  }

  // Recording resources belong to a project, not to each render's callbacks.
  useEffect(() => {
    mounted.current = true
    busy.current = false
    stopping.current = false
    stopTarget.current = 'stopped'
    // A project change must clear visible content before restoring its own file.
    // oxlint-disable-next-line react/set-state-in-effect
    setTranscript([])
    setHistorySession(sessionId)
    setRecording('stopped')
    setElapsedSeconds(0)
    setLoaded(false)
    setError('')
    setHistoryError('')
    setSpeakerWarning('')
    setStormWarning('')
    setStorm(null)
    stormEvents.current.clear()
    const controller = new AbortController()
    let retryTimer: number | undefined
    let retryDelay = 1000
    async function restoreHistory() {
      if (controller.signal.aborted) return
      // Never replace live captions with an older file while starting or saving.
      if (busy.current) {
        retryTimer = window.setTimeout(restoreHistory, retryDelay)
        return
      }
      const request = historyRequest.current + 1
      try {
        await loadTranscript(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]))
      } catch (err) {
        if (controller.signal.aborted || request !== historyRequest.current) return
        setHistoryError(`Saved transcript unavailable. Retrying automatically. ${err instanceof Error ? err.message : 'Check the transcription service.'}`)
        retryTimer = window.setTimeout(restoreHistory, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30000)
      }
    }
    void restoreHistory()
    return () => {
      mounted.current = false
      controller.abort()
      window.clearTimeout(retryTimer)
      cleanupRecording()
    }
  }, [sessionId, loadTranscript])

  useEffect(() => {
    if (recording !== 'recording') return
    const timer = window.setInterval(() => setElapsedSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  function abandonConnection(message: string) {
    clearTimers()
    releaseAudio()
    const socket = resources.current.socket
    resources.current.socket = undefined
    socket?.close()
    busy.current = false
    if (mounted.current) { setError(message); setRecording('stopped') }
  }

  function stopRecording(pause = false) {
    if (stopping.current) return
    stopTarget.current = pause ? 'paused' : 'stopped'
    stopping.current = true
    releaseAudio()
    window.clearTimeout(readyTimer.current)
    const socket = resources.current.socket
    if (socket?.readyState !== WebSocket.OPEN) {
      abandonConnection('Recording disconnected; final transcript saving was not confirmed.')
      return
    }
    setRecording('saving')
    completionTimer.current = window.setTimeout(() => {
      abandonConnection('Saving was not confirmed within one minute. Check the transcript before recording again.')
    }, 60000)
    socket.send(JSON.stringify({ action: 'stop' }))
  }

  async function finishRecording() {
    const socket = resources.current.socket
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      if (busy.current) throw new Error('Recording is still starting or saving. Please wait.')
      return
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.removeEventListener('close', onClose)
        reject(new Error('Recording is still saving. Please wait and retry.'))
      }, 65000)
      function onClose(event: CloseEvent) {
        window.clearTimeout(timeout)
        if (event.code === 1000) resolve()
        else reject(new Error('Recording did not finish saving. Please check this transcript before switching storms.'))
      }
      socket.addEventListener('close', onClose, { once: true })
      stopRecording()
    })
  }

  async function startRecording() {
    if (busy.current) return
    busy.current = true
    stopping.current = false
    setError('')
    setSpeakerWarning('')
    setStormWarning('')
    stormEvents.current.clear()
    // Start is a user gesture; wake browser speech output before asynchronous setup.
    window.speechSynthesis?.resume()
    setRecording('connecting')
    stopTarget.current = 'stopped'
    const request = historyRequest.current + 1
    const stillCurrent = () => mounted.current && request === historyRequest.current
    try {
      // Reload each time, including after another browser changed the room's file.
      await loadTranscript()
      if (!stillCurrent()) return
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false })
      if (!stillCurrent()) { stream.getTracks().forEach(track => track.stop()); return }
      resources.current.stream = stream
      const context = new AudioContext({ sampleRate: 24000 })
      resources.current.context = context
      await context.resume()
      if (!stillCurrent()) { if (context.state !== 'closed') await context.close(); return }
      if (context.sampleRate !== 24000) throw new Error('This browser does not support 24 kHz microphone audio.')
      await context.audioWorklet.addModule('/pcm-worklet.js')
      if (!stillCurrent()) { if (context.state !== 'closed') await context.close(); return }
      const node = new AudioWorkletNode(context, 'pcm-recorder')
      resources.current.node = node
      const url = new URL(sessionUrl('/ws/transcribe', sessionId), window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      resources.current.socket = socket
      let ready = false
      let failed = false
      stream.getAudioTracks()[0].onended = () => {
        setError('Microphone disconnected. Recording stopped.')
        stopRecording()
      }
      readyTimer.current = window.setTimeout(() => {
        abandonConnection('The transcription service did not become ready. Try again.')
      }, 15000)
      node.port.onmessage = event => {
        if (ready && !stopping.current && socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > 240000) {
            setError('Connection too slow to record reliably. Please retry.')
            stopRecording()
            return
          }
          // Preserve the provider's audio clock with silence while Storm owns the floor.
          const pcm = event.data as ArrayBuffer
          if (stormMuted.current) new Uint8Array(pcm).fill(0)
          socket.send(pcm)
        }
      }
      socket.onmessage = event => {
        if (!mounted.current || resources.current.socket !== socket) return
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'ready' && !stopping.current) {
            window.clearTimeout(readyTimer.current)
            ready = true
            context.createMediaStreamSource(stream).connect(node)
            node.connect(context.destination)
            setRecording('recording')
          } else if (message.type === 'transcript') {
            setTranscript(current => [...current, transcriptLine(message)])
          } else if (message.type === 'speakers') {
            setTranscript(current => applySpeakers(current, message.replace_ids, message.lines))
          } else if (message.type === 'speaker_status') {
            setSpeakerWarning(message.message || '')
          } else if (message.type === 'storm_status') {
            setStormWarning(message.message || '')
          } else if (message.type === 'storm') {
            if (typeof message.id !== 'string' || typeof message.text !== 'string' || stormEvents.current.has(message.id)) return
            stormEvents.current.add(message.id)
            setTranscript(current => [...current, transcriptLine({ ...message, agent: 'storm', pending: false })])
            if (ready && !stopping.current) {
              stormVoice.current ??= createStormVoice(
                value => { if (mounted.current) setStorm(value) },
                muted => { stormMuted.current = muted },
                warning => { if (mounted.current) setStormWarning(warning) },
              )
              stormVoice.current.speak(message)
            }
          } else if (message.type === 'error') {
            failed = true
            setError(message.message || 'Transcription failed.')
            stopRecording()
          }
        } catch {
          failed = true
          setError('The transcription service sent an invalid response.')
          stopRecording()
        }
      }
      socket.onerror = () => {
        if (resources.current.socket === socket) abandonConnection('Cannot connect to the transcription backend; final saving was not confirmed.')
      }
      socket.onclose = async event => {
        if (resources.current.socket !== socket) return
        clearTimers()
        releaseAudio()
        resources.current.socket = undefined
        if (!mounted.current) return
        const closingRequest = historyRequest.current + 1
        setRecording('saving')
        if (event.code !== 1000 && !failed) setError('Recording disconnected; final transcript saving was not confirmed.')
        try {
          // The close handshake confirms that the final append has finished.
          if (event.code === 1000 && !failed && !restartingTranscript.current) await loadTranscript()
        } catch (err) {
          if (closingRequest === historyRequest.current) setError(`Recording saved, but reload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
          if (mounted.current && closingRequest >= historyRequest.current) {
            busy.current = false
            setRecording(stopTarget.current)
          }
        }
      }
    } catch (err) {
      if (stillCurrent()) abandonConnection(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  async function resetTranscript() {
    if (busy.current) return
    busy.current = true
    setResetting(true)
    setError('')
    ++historyRequest.current
    try {
      const response = await fetch(sessionUrl('/transcript/reset', sessionId), { method: 'POST', signal: AbortSignal.timeout(8000) })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Could not reset transcript.')
      }
      if (mounted.current) { setTranscript([]); setElapsedSeconds(0); setLoaded(true); setSpeakerWarning(''); setStormWarning(''); setHistoryError('') }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not reset transcript.')
    } finally {
      busy.current = false
      if (mounted.current) setResetting(false)
    }
  }

  async function restartTranscript() {
    restartingTranscript.current = true
    try {
      const socket = resources.current.socket
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Recording is still saving. Please wait and retry.')), 65000)
          socket.addEventListener('close', event => {
            window.clearTimeout(timeout)
            if (event.code === 1000) resolve()
            else reject(new Error('Recording did not finish saving. Download your memory before retrying.'))
          }, { once: true })
          stopRecording(true)
        })
      }
      ++historyRequest.current
      const response = await fetch(sessionUrl('/transcript/reset', sessionId), { method: 'POST', signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Could not clear the transcript. Please retry once the backend is available and all recordings have stopped.')
      setTranscript([])
      setHistoryError('')
      setSpeakerWarning('')
      setStormWarning('')
      setElapsedSeconds(0)
      setLoaded(true)
      setRecording('stopped')
    } finally {
      restartingTranscript.current = false
    }
  }

  async function exportTranscript() {
    try {
      const blob = new Blob([await readTranscript()], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `storm-${sessionId}-transcript.txt`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not export transcript.')
    }
  }

  return { transcript: historySession === sessionId ? transcript : [], recording, resetting, error: error || historyError, speakerWarning, stormWarning, storm, loaded: historySession === sessionId && loaded, elapsedSeconds, startRecording, stopRecording, finishRecording, resetTranscript, restartTranscript, exportTranscript }
}
