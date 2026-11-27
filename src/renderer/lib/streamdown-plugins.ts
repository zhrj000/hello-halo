/**
 * Streamdown plugin configuration (lazy-loaded)
 *
 * Heavy markdown plugins (Shiki code highlighter, KaTeX math) are imported
 * asynchronously to avoid blocking the module graph in Vite dev mode and to
 * keep them out of the initial bundle. Each plugin initializes on first use
 * and caches the result for subsequent renders.
 */

import { useState, useEffect } from 'react'
import type { CodeHighlighterPlugin, MathPlugin } from 'streamdown'

/**
 * Builds a React hook that lazy-loads a Streamdown plugin once, caches it at
 * module scope, and returns `undefined` until the plugin is ready.
 *
 * The cache is shared across all hook callers so the plugin is constructed at
 * most once per session, regardless of how many renderers mount.
 */
function createLazyPluginHook<T>(loader: () => Promise<T>): (() => T | undefined) & { preload: () => Promise<T> } {
  let cached: T | null = null
  let loadPromise: Promise<T> | null = null

  const load = (): Promise<T> => {
    if (!loadPromise) {
      loadPromise = loader().then(plugin => {
        cached = plugin
        return plugin
      }, error => {
        // A failed (early) load is tried again by the next renderer that asks.
        loadPromise = null
        throw error
      })
    }
    return loadPromise
  }

  function useLazyPlugin(): T | undefined {
    const [plugin, setPlugin] = useState<T | undefined>(cached ?? undefined)

    useEffect(() => {
      if (cached) {
        setPlugin(cached)
        return
      }
      load().then(setPlugin)
    }, [])

    return plugin
  }
  return Object.assign(useLazyPlugin, { preload: load })
}

/**
 * Shiki code highlighter plugin (bounded token cache, see `shiki-code-plugin.ts`).
 *
 * Dark theme first: inline `color` uses the first theme's values, which must
 * be readable on dark backgrounds (our default). The second theme goes into
 * the `--shiki-dark` CSS var for light mode.
 *
 * Pass it only to finished content. A streaming renderer re-highlights the
 * whole block on every delta, so streaming code renders without it.
 */
export const useCodePlugin = createLazyPluginHook<CodeHighlighterPlugin>(() =>
  import('./shiki-code-plugin').then(m =>
    m.createShikiCodePlugin({ themes: ['github-dark', 'github-light'] })
  )
)

/**
 * KaTeX math plugin — enables `$...$` inline and `$$...$$` block formulas.
 *
 * Streamdown declares `MathPlugin.getStyles` but never injects it, so the
 * KaTeX stylesheet is imported directly by the renderer instead.
 */
export const useMathPlugin = createLazyPluginHook<MathPlugin>(async () => {
  const [remarkMath, rehypeKatex] = await Promise.all([
    import('remark-math').then(m => m.default),
    import('rehype-katex').then(m => m.default),
  ])
  return {
    name: 'katex',
    type: 'math',
    remarkPlugin: remarkMath,
    rehypePlugin: rehypeKatex,
  }
})

/**
 * Loads both plugins ahead of the first transcript. A renderer that mounts
 * before they arrive renders every reply plain and then again once they land,
 * which is what made the first conversation opened after launch slow; started
 * when the app is idle after its first screen, they are ready by then.
 */
export function preloadMarkdownPlugins(): void {
  const start = () => {
    void useCodePlugin.preload().catch(error => console.warn('[Markdown] Code highlighter preload failed:', error))
    void useMathPlugin.preload().catch(error => console.warn('[Markdown] Math preload failed:', error))
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 3000 })
  else setTimeout(start, 1500)
}
