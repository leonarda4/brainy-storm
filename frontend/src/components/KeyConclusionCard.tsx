export function KeyConclusionCard({
  conclusion,
  takeaway,
  fallback,
}: {
  conclusion?: string | null
  takeaway?: string | null
  fallback?: string | null
}) {
  const content = takeaway || conclusion || fallback

  if (!content) return null

  return (
    <section className="key-conclusion-card" aria-label="Conclusion">
      <h2 className="conclusion-heading">Conclusion so far</h2>
      <p className="conclusion-text">{content}</p>
    </section>
  )
}
