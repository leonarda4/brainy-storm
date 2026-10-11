# Pros & Cons Identified from Body (Categorized & Sorted)

*Sorted by impact and risk.*

The team conditionally favors the tool for its practical utility, though concerns linger regarding technical uninventiveness, demo excitement, and pre-formed teams.

## Pros Voiced in Discussion

### Operations — High Impact

Mandatory hackathon registration naturally motivates participants to provide personal interest data without extra friction.

*"Leonarda noted that attendees are already registering anyway, providing a natural incentive to share information."*

### User Experience — High Impact

Conversational agents elicit deeper motivations and problem interests beyond superficial lists of programming languages.

*"Marko argued an agent extracts richer context when users do not know how to describe what they want."*

### Technical — Medium Impact

Using organizer-supplied data, standard embeddings, and Postgres keeps implementation scope realistic for a hackathon.

*"Giacomo observed that scoping data to one hackathon and using embeddings makes it a manageable problem."*

### User Experience — Medium Impact

Scanning QR codes to deliver contextual conversation starters offers clear, practical in-person utility.

*"Leonarda and Alex endorsed scanning participant QR codes to generate immediate conversation starters."*

### User Experience — Low Impact

Interest-cluster visualizations can provide an interactive frontend without requiring complex graph database architecture.

*"Marko suggested visualizing participants as an interest graph, which Alex noted does not require a graph database."*

## Cons Voiced in Discussion

### Business & Market — High Risk

Many hackathon participants arrive with pre-formed teams, drastically shrinking the target market for match recommendations.

*"Leonarda acknowledged the critical point that many people arrive at hackathons already having formed teams."*

### Operations — High Risk

Evaluating true match quality and post-meeting satisfaction is unfeasible within a rapid hackathon weekend timeframe.

*"Alex pointed out that evaluating whether two people are a good match cannot be done in a weekend."*

### Technical — Medium Risk

Storing profiles in Postgres with LLM summaries is technically mundane and lacks wow factor for judging.

*"Alex criticized the Postgres and LLM recommendation architecture as technically boring for a hackathon project."*

### User Experience — Medium Risk

Presenting text-heavy recommendation lists with generated reasoning lacks compelling visual presentation compared to interactive visual demos.

*"Giacomo argued the output risks being an unappealing list of random people with text explanations."*

### User Experience — Low Risk

Replacing simple registration inputs with conversational prompts overcomplicates the sign-up process for attendees.

*"Giacomo questioned the need to replace simple registration forms with conversational agents."*
