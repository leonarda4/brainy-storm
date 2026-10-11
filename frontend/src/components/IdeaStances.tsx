import { ArrowDown, ArrowUp } from 'lucide-react'
import { AvatarGroup } from '../AvatarGroup'
import { ideaParticipants } from '../ideaParticipants'
import type { GeneratedIdea } from '../ideaWorkspace'

function StanceGroup({ people, opposing = false }: { people: ReturnType<typeof ideaParticipants>; opposing?: boolean }) {
  if (!people.length) return null
  const label = `${people.length} ${opposing ? (people.length === 1 ? 'opponent' : 'opponents') : (people.length === 1 ? 'supporter' : 'supporters')}: ${people.map(person => person.name).join(', ')}`
  const Icon = opposing ? ArrowDown : ArrowUp

  return <AvatarGroup
    participants={people}
    maxVisible={1}
    label={label}
    className={`idea-stance-group ${opposing ? 'idea-opponents' : 'idea-supporters'}`}
    prefix={<span className="idea-stance-count" aria-hidden="true"><Icon size={14} /><span>{people.length}</span></span>}
  />
}

export function IdeaStances({ idea }: { idea: Pick<GeneratedIdea, 'proponents' | 'opponents'> }) {
  const supporters = ideaParticipants(idea.proponents)
  const opponents = ideaParticipants(idea.opponents)
  if (!supporters.length && !opponents.length) return null

  return <div className="idea-stances">
    <StanceGroup people={supporters} />
    <StanceGroup people={opponents} opposing />
  </div>
}
