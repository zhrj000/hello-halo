const FENCE_OR_RULE = /^\s*(?:```|~~~|(?:[-*_]\s*){3,}$|\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$)/

/**
 * Markdown as the plain lines it reads as, for a clamped preview where rendering
 * would cost too much: syntax marks and blank lines dropped, list items kept as bullets.
 */
export function markdownPreview(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\r?\n/)
    .filter(line => !FENCE_OR_RULE.test(line))
    .map(line => line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '• ')
      .replace(/\*\*|__|~~|`/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
}
