import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlackboardTask, TeamConversation, TeamDetail } from '../../../src/shared/apps/team-types'

vi.mock('../../../src/renderer/i18n', () => ({
  useTranslation: () => ({ t: (text: string, vars?: Record<string, unknown>) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars?.[key])) }),
}))
vi.mock('../../../src/renderer/components/apps/AutomationAvatar', () => ({
  AutomationAvatar: ({ name }: { name: string }) => createElement('span', { 'data-avatar': name }),
}))
import { TeamTaskOverview, type TaskOutput } from '../../../src/renderer/components/team/TeamTaskOverview'
import type { TaskActivityData } from '../../../src/renderer/components/team/workbench/useTaskActivity'
import type { TaskProgress } from '../../../src/renderer/components/team/workbench/progress'

const subtask = (id: string, status: BlackboardTask['status']) => ({ id, title: `task ${id}`, status, assigneeAppId: 'a', createdByAppId: 'lead', createdAt: 1, updatedAt: 2 } as BlackboardTask)
const output = (name: string): TaskOutput => ({ entry: { name, path: `/out/${name}`, ref: name, epochId: 'e' }, at: null })

function render({ tasks, outputs = [], status = 'ready', finished = true, task = {}, roster = [], open = {} }: {
  tasks: BlackboardTask[]; outputs?: TaskOutput[]; status?: 'loading' | 'ready' | 'failed'; finished?: boolean; task?: Partial<TeamConversation>; roster?: unknown[]; open?: Record<string, boolean>
}) {
  const data = {
    tasks, activities: [], pending: [], busy: [], loaded: true, failed: false, retry: vi.fn(),
    artifacts: { status, list: outputs.map(row => row.entry), openEntry: vi.fn() },
  } as unknown as TaskActivityData
  const progress: TaskProgress = { members: [], counts: { done: 0, in_progress: 0, blocked: 0, pending: 0, rejected: 0 }, total: tasks.length, finished }
  return renderToStaticMarkup(createElement(TeamTaskOverview, {
    detail: { team: { id: 't', name: 'Team', leadAppId: 'lead' }, roster } as unknown as TeamDetail,
    task: { epochId: 'e', label: 'Work', startedAt: 1, ...task } as TeamConversation,
    data, progress, lastActs: new Map(), outputs, open,
    onToggle: vi.fn(), onDecision: vi.fn(), onOpenMember: vi.fn(), onOpenActivity: vi.fn(), onGo: vi.fn(),
  }))
}

describe('team task overview once finished', () => {
  it('lists the outputs right under the brief, with nothing to scroll to', () => {
    const html = render({ tasks: [subtask('1', 'done')], outputs: [output('report.md')] })
    expect(html.indexOf('aria-label="Outputs"')).toBeLessThan(html.indexOf('aria-label="Subtasks"'))
    expect(html).not.toContain('View outputs')
    const working = render({ tasks: [subtask('1', 'done')], outputs: [output('report.md')], finished: false })
    expect(working.indexOf('aria-label="Outputs"')).toBeGreaterThan(working.indexOf('aria-label="Subtasks"'))
  })
  it('briefs only what the status line does not say, and drops the brief when that is nothing', () => {
    const html = render({ tasks: [subtask('1', 'done'), subtask('2', 'done')] })
    expect(html).toContain('2/2 subtasks')
    expect(html).toContain('No output files')
    expect(html).not.toContain('aria-label="Outputs"')
    expect(render({ tasks: [subtask('1', 'done'), subtask('2', 'rejected')] })).toContain('1 subtasks completed, 1 rejected')
    expect(render({ tasks: [subtask('1', 'done')], task: { finishedAt: 5, summary: 'Shipped' } })).toContain('>Shipped</p>')
    const plain = render({ tasks: [subtask('1', 'done')], outputs: [output('report.md')] })
    expect(plain).not.toContain('subtasks completed')
    expect(plain).not.toContain('bg-card')
  })
  it('lists settled subtasks plainly under the strip, grouping only work still moving', () => {
    const settled = render({ tasks: [subtask('1', 'done'), subtask('2', 'done')] })
    expect(settled).toContain('task 1')
    expect(settled).not.toContain('aria-expanded')
    expect(settled).toContain('h-[5px]')
    const moving = render({ tasks: [subtask('1', 'done'), subtask('2', 'in_progress')], finished: false })
    expect(moving).toContain('aria-expanded')
    expect(moving).toContain('h-[5px]')
  })
  it('opens the assignee\'s conversation from any subtask, done or not started', () => {
    const inButton = (html: string, text: string) => new RegExp(`<button[^>]*>(?:(?!</button>).)*${text}`).test(html)
    const roster = [{ appId: 'a', memberName: 'Ann' }]
    expect(inButton(render({ tasks: [subtask('1', 'done')], roster }), 'task 1')).toBe(true)
    expect(inButton(render({ tasks: [subtask('1', 'pending'), subtask('2', 'in_progress')], finished: false, open: { pending: true }, roster }), 'task 1')).toBe(true)
    expect(inButton(render({ tasks: [subtask('1', 'done')] }), 'task 1')).toBe(false)
  })
  it('heads the page with the task, the team as its context', () => {
    const html = render({ tasks: [] })
    expect(html.indexOf('Team')).toBeLessThan(html.indexOf('<h2'))
    expect(html).toMatch(/<h2[^>]*>Work<\/h2>/)
  })
  it('keeps unknown outputs from reading as none', () => {
    const loading = render({ tasks: [subtask('1', 'done')], status: 'loading' })
    expect(loading).toContain('Loading outputs…')
    expect(loading).not.toContain('No output files')
    expect(render({ tasks: [subtask('1', 'done')], status: 'failed' })).toContain('Could not load outputs.')
  })
})
