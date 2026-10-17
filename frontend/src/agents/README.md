Memo and Storm geometry and motion engine from https://github.com/leonarda4/brainy-hq (motion kit v1.1). JavaScript exports adapted to ES modules; character styles scoped to avoid product avatar styles.

Brainy uses the original six-lobed circle geometry from `/Users/leonarda/Documents/DESIGN/brainy-storm/brainystorm-brainy.svg`, with sampled circle outlines for label placement and the shared thinking motion.

Loading copy lives in `../loadingPhrases.ts`. Use `nextLoadingWord(purpose, previousWord)` and `formatLoadingPhrase(subject, word)` outside React, or `useLoadingPhrase(subject, purpose, active)` in a component. Purposes: thinking, research, writing, organizing. Extend the shared catalog to add a purpose. The hook pauses rotation when inactive or the document is hidden and clears its timer on unmount. Keep decorative rotating copy out of live regions; provide a stable accessible status instead.
