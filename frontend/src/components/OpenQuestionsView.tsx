import { useId } from 'react'

export function OpenQuestionsView({ questions }: { questions?: string[] | null }) {
  const headingId = useId()
  const visibleQuestions = (questions || []).map(question => question.trim()).filter(Boolean)

  if (visibleQuestions.length === 0) return null

  return (
    <section className="open-questions-section" aria-labelledby={headingId}>
      <div className="open-questions-header">
        <h3 id={headingId} className="detail-heading">Open questions</h3>
      </div>
      <ol className="open-questions-list">
        {visibleQuestions.map((question, index) => (
          <li key={`${index}-${question}`}>
            <span aria-hidden="true">{index + 1}</span>
            <p>{question}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
