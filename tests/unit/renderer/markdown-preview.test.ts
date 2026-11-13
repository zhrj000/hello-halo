/**
 * A clamped preview reads as the text, never as Markdown source.
 */

import { describe, expect, it } from 'vitest'
import { markdownPreview } from '../../../src/renderer/utils/markdown-preview'

describe('markdownPreview', () => {
  it('drops syntax marks and keeps one line per block', () => {
    const report = [
      '润色完成，v2 已交付主编。',
      '',
      '**成果**',
      '- 成稿：`halo-promo-v2.md`',
      '- 正文 **1611 字**',
      '',
      '## 守住的边界',
      '> 结构未重排',
    ].join('\n')
    expect(markdownPreview(report)).toBe('润色完成，v2 已交付主编。\n成果\n• 成稿：halo-promo-v2.md\n• 正文 1611 字\n守住的边界\n结构未重排')
  })

  it('keeps link and image text and drops fences, rules and table separators', () => {
    const text = ['See [the brief](https://example.com) ![chart](a.png)', '```ts', 'const a = 1', '```', '---', '| a | b |', '| --- | :-: |', '- [x] done'].join('\n')
    expect(markdownPreview(text)).toBe('See the brief chart\nconst a = 1\n| a | b |\n• done')
  })

  it('leaves plain text as it is', () => {
    expect(markdownPreview('Draft sent to the editor')).toBe('Draft sent to the editor')
  })
})
