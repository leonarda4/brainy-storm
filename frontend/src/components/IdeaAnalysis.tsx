import type { Idea } from '../ideaWorkspace'
import { KeyConclusionCard } from './KeyConclusionCard'
import { ProsConsView } from './ProsConsView'
import { CompetitorsView } from './CompetitorsView'
import { DiagramsView } from './DiagramsView'
import { EnrichedJsonView } from './EnrichedJsonView'

// Cards and the editable page share the same live analysis and controls.
export function IdeaAnalysis({ idea }: { idea: Idea }) {
  const conclusion = idea.metadata?.key_takeaway || idea.metadata?.key_conclusion || idea.conclusion

  return <>
    {conclusion && <KeyConclusionCard conclusion={conclusion} />}
    <ProsConsView data={idea.pros_cons} />
    <DiagramsView workflow={idea.workflow} systemGraph={idea.systemGraph} ideaId={idea.originalId || idea.id} />
    <CompetitorsView data={idea.competitors} />
    <EnrichedJsonView data={idea.rawIdea || idea} ideaId={idea.originalId || idea.id} />
  </>
}
