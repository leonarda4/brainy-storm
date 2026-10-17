import { Fragment } from 'react'
import { Avatar } from './Avatar'
import { AgentCharacter } from './AgentCharacter'
import { transcriptDateKey, transcriptDateLabel } from './transcript'
import type { TranscriptLine } from './transcript'

type TranscriptContentProps = {
  transcript: TranscriptLine[]
  recording: string
  stormActive?: boolean
}

export function TranscriptContent({ transcript, recording, stormActive = false }: TranscriptContentProps) {
  const completed = transcript.filter(line => !line.pending)
  // Only the newest pending speech can identify the active speaker. A previous
  // completed turn is not evidence that the same person is still talking.
  const speaking = transcript.findLast(line => line.pending)

  return <>
    {completed.map((line, index) => <Fragment key={line.id || index}>
      {line.recordedAt && transcriptDateKey(line.recordedAt) !== transcriptDateKey(completed[index - 1]?.recordedAt) && <div className="transcript-date"><span /><time dateTime={transcriptDateKey(line.recordedAt)}>{transcriptDateLabel(line.recordedAt)}</time><span /></div>}
      <article className={`transcript-line${line.agent === 'storm' ? ' storm-transcript-line' : ''}`}>
        {line.agent === 'storm' ? <div className="storm-transcript-avatar"><AgentCharacter name="Storm" compact avatar /></div> : <Avatar className="speaker-avatar" initials={line.initials} color={line.color} aria-hidden="true" />}
        <div className="transcript-line-content">
          <div className="speaker-meta"><strong>{line.person}</strong>{line.recordedAt && <time dateTime={line.recordedAt} title={new Date(line.recordedAt).toLocaleString()}>{line.time}</time>}</div>
          <p>{line.text}</p>
        </div>
      </article>
    </Fragment>)}
    {recording === 'recording' && !stormActive && speaking && (
      <div className="transcript-speaking" role="status" aria-atomic="true">
        <Avatar className="speaker-avatar" initials={speaking.initials} color={speaking.color} aria-hidden="true" />
        <span>{speaking.person === 'Unknown' ? 'Someone is speaking' : <><strong>{speaking.person}</strong> is speaking</>}</span>
        <span className="capture-pulse" aria-hidden="true" />
      </div>
    )}
    {recording === 'saving' && <div className="transcript-capture" role="status">Finishing transcript…</div>}
  </>
}
