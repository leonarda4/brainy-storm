import { useEffect, useState } from 'react'
import { animateThumbnail } from '../thumbnailMotion'

/** A fresh SVG document replays the studio motion on mount and image replacement. */
export function IdeaThumbnail({ src }: { src: string }) {
  const [animated, setAnimated] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    async function prepare() {
      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.includes('svg')) return
        const svg = animateThumbnail(await response.text())
        if (!svg || controller.signal.aborted) return
        objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        setAnimated(objectUrl)
      } catch { /* Keep the original image if the artwork cannot be animated. */ }
    }
    void prepare()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src])
  return <img key={animated || src} className="idea-thumbnail" src={animated || src} alt=""
    onError={event => { event.currentTarget.style.display = 'none' }} />
}
