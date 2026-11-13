# Team task workbench

## Ownership and boundaries

This directory owns the task workspace's presentation and navigation. Persistence,
viewer relationships and lifecycle admission belong to
[`apps/team`](../../../../main/apps/team/DESIGN.md) and `apps/runtime/team`.
A task and a selected member are separate navigation coordinates. Selecting a
member must not change the task or grant access to another person's private chat.

`TaskRoom` composes the conversation, decisions and execution observation.
`TaskConversation` and `model.ts` project persisted messages into human exchanges
and compact coordination. The owner's additions to running work belong to that
work: drawn on the reply they joined, as in the chat transcript, or on their own
where no shown reply carries them — they never start a human exchange, so a
background turn keeps its live range after reload. `TeamSessionChat` remains the shared team session
transport and streaming surface. `TaskExecutionView` reuses the chat thought/tool
components; it does not implement another tool renderer. The task activity drawer
contains the selected task's team record, not a cross-task notification feed.

## Interaction contract

A source conversation's coordinator is never a selectable digital human. Its
activity is labelled as the main conversation, with an owner-local return link.
Saving keeps this source view open and offers a link to the separately saved
ordinary team, which has a real lead and no copied tasks or transcripts. Repeated
saves use the persisted link, never create another copy. Legacy saved teams are
repaired only on their owner's machine. A joined copy names that owner and tells
the reader they do not need to update; a failed local repair offers retry or a
new team while existing records remain readable. Neither case permits new work
against the broken coordinator address.
If the source conversation or its members are still working, local repair is
deferred and the notice offers a return to that conversation and an explicit
retry. An unfinished historical task alone never triggers this notice.

Native team conversations open in the homepage through the team module's public
`TeamConversationHost`. The homepage owns the conversation target; the host composes
`TaskRoom` without another task sidebar or member rail. Its team progress (tasks,
outputs, collaboration history and member execution) opens as a `team-task` tab in
the right canvas instead of a drawer; the tab reads its own board for the task, and
reopening it reuses the tab and reveals the requested record or member.
The Teams page retains its existing workbench, including native conversations,
management and external/run history; opening or creating work there stays in that
workbench. Both entry points access the same retained team records.
The homepage draft invites ordinary conversation, not task creation; starting a
conversation persists its scope but does not itself assign board work. Member turns
may explicitly create board tasks. The homepage does not offer a complete-task action
for an ordinary conversation; its internal lifecycle remains unchanged.
The homepage room has no pane header: the title lives in the app top bar (also on
mobile) and renaming belongs to the list row menu. The member row above the composer
is the conversation bar, starting at the left edge with nothing beside it: the team
progress opens from its status, and "view in team" stays in the list row menu. It
concerns the conversation, not the message, so the composer itself stays identical to
the personal chat composer, editable or locked.
The conversation bar is one capsule: the avatars, the members toggle (an upward
chevron, with "+N" before it when avatars fold) that opens the all-members panel, a
divider, then the conversation status. Each part opens what it shows: the status
opens the team progress, never the member list. It carries no arrow (the send button
below already has one); on hover it fills like the toggle under a "View team progress"
tip, and where there is no progress to open it is plain text. The status tells what
needs the reader or is under way, not who is in the team. The status is an icon and a summary (who waits for the user, whose
message did not arrive, who waits for a decision, who besides the lead is working, or
"completed" with the output count, by the same rule as the progress canvas's
`taskProgress().finished`, else "team progress") and, when the board has
tasks, a done count with a bar filled by done tasks (blocked ones in amber); it is
absent while there is no progress. The status always reads in full: when the row is narrow the bar
gives way first, then avatars fold into "+N". A failed member's avatar carries a red dot
that clears once that member acts again. Nothing opens on its own. The stream has no progress card.
A temporary space collaboration has no task selection at all: its one
conversation (`kind: 'collab'`) is the room, so it is never a choice — the task
list, its search and filters, the way to create a task and the links that leave
for another task are all absent, leaving the room and the members beside it.
Task activity is a modal drawer bound to that selection; it has no independent task selector.
It contains unfinished work, outputs, coordination history and internal member
reports. Switching the selected digital human changes only the member view inside
the current task. Every team member uses the same conversation and execution
renderer; a teammate-owned digital human is read-only and keeps its ownership
boundary visible: the composer stays in place, locked, with the reason written inside
(also when the owner's computer is offline).
A local member's reply shows its "changed files" footer as in ordinary chat and
opens the changes in the right canvas (`TeamSessionChat` provides the scope; the
process is read from the member's own transcript). A remote member's replies have
no local transcript, so their footer stays a plain summary.
What a member received right before its reply (non-failed collaboration messages
addressed to it) is the cause of that reply, so it is drawn on the reply's sender
line as in ordinary chat ("Lead · Received a report from X"), expanding to the full
text; it is not a separate collapsible card. Messages the member sent, failures and
anything not followed by a reply keep the collaboration segment card in the Teams
workbench. On the homepage, what the member handed on right after a reply is drawn
under the reply of the turn that sent it as one "Lead · Sent a message to X" line, styled like the sender line, that
expands to the messages; what it received while its reply is still being written
shows as that same sender line on its own, so the reply arriving does not restyle it;
anything no shown reply carries (a turn that only handed work on, or one cut off by
the user's message) is drawn the same way, received and sent lines in order, so the
homepage never shows a collaboration segment card; a message the reply's own
work already shows (received mid-turn, matched by the request id its record and
the activity share) is not named again on the sender line; and
failures leave the stream for the conversation bar. Expanded, each message's party
name leads to that party's view in the same conversation, opened at that message,
since what followed it is read there; the footer repeats the link only when there
is a single party. A party with no view of its own (the main conversation, a former
member) is plain text and the footer leads to team progress instead. The homepage also shows a
member's replies to teammates and to their turn-end reports as chat replies, even
before the user writes to it, so collaboration reads as dialogue rather than segment
cards; replies to periodic checks and run starts stay in execution records, and
never a copy of the last reply follows them.
Live work there reads as a reply being written in personal chat (sender name,
the same collapsible thought panel, streaming text) with no status frame; its
name is omitted when the received line above it already names the member. Only
failed or unavailable execution keeps the status row. An empty member view there looks
like an empty digital-human chat: the member's avatar and an invitation to write
(or "No messages yet" when the user cannot write to it), not a notice card.
A remote member whose owner is offline and of whom this computer holds no copy is
not a load failure: its view says the owner's computer is offline, offers no
retry, and reloads when that owner's presence changes. A held copy stays shown
under the offline notice and refreshes the same way.
The team header keeps the selected task visually primary: the team goal is
available on demand instead of occupying a persistent subtitle. Sidebar group
names describe the task source plainly; inbound channel work is labelled as IM
conversations, while unrelated work in the same team is labelled as other tasks.
Answers occur in the room, scoped by the persisted question's execution id,
never by a member-wide waiting flag. On the homepage the member selector sits above the composer, aligned to
the ordinary chat composer's width with no divider; the message stream uses that same width, and the composer placeholder names the selected member. It is an avatar
rail: one click on an avatar switches member, the selected member is lifted onto a sliding
thumb with its name unfolded, and a read-only member's face carries a light veil with a
lock at its center (`.avatar-lock-badge`, under the status dot; the panel's and the
card's avatars carry it too), so who can be talked to reads at a glance. Selecting a read-only member
keeps its locked composer, which names whose digital human it is and that the user
reaches it through one of their own, and offers to talk to that one instead, the
lead first when it is theirs.
Avatar status is scoped to this conversation: a steady dot at the avatar's corner
(`.avatar-status-dot`, a quarter of the avatar so it keeps one proportion at every size),
blue while the member has a busy row for this execution, orange while one of my
members has a pending question here, red after a failure; the panel's avatars carry the same dot.
An unselected avatar's card (hover-capable pointers and keyboard focus, never touch)
opens from the bar's left edge on the panel's surface (a card, not a dark tooltip):
avatar with name and lead/role, duty, its state in this conversation (read-only
members included) and, below a divider, who may message it with the owner's offline
state. It holds no actions; those stay in the panel. The rail is left-aligned so switching never shifts the avatars before the
selected one, and it fits the width left beside the status (at most eight avatars);
larger teams collapse the rest behind a "+N" chip. The all-members panel opens upward
from the bar's left edge: an "All members" header (the done count and bar stay on
the bar itself, not repeated here), then every
member grouped into needs your attention (waiting for me or failed), working, my
digital humans and other read-only members, each with what it needs or is doing; a
waiting member offers Answer, a failed one View. Search appears past eight members;
keyboard navigation always, without on-screen key hints. It has no footer: the team
progress is the status's job, never a second step through the member list. The current member, my members waiting for me and recently picked members
(kept in memory only) stay on the rail; shown avatars keep team order and never trade
places. The chip carries a dot when a hidden member is waiting for me. It remains
present when input is read-only or unavailable. The order stays lead,
owned, then other members in roster order. Only owned digital humans and local temporary collaborators in this work may send. New homepage
conversations default to the actual lead even when read-only; a task someone else
started that one of my members took part in opens on that member (read from the
board, with no fallback to the lead until the board is known); a missing remembered
member requires a new explicit choice. Switching preserves the conversation and
per-member transcript and draft, never opens private chat, and a team that fits the
rail needs no overflow chip.
An ordinary conversation that started a temporary team (`TeamCollabBar`) shows the
same conversation bar above its own composer, aligned the same way, preceded by a
"Temporary team" tag. The conversation itself leads that team, so the user keeps
talking to it: no member is selected while the conversation is shown. An avatar
shows that member's work in place of the chat (`TeamCollabMemberView`), selected on
the same rail; the composer stays locked, says temporary members cannot be messaged
and offers "Back to main chat", the only way back besides the member or team going
away. The rail gains no main-chat item. The panel groups the
non-waiting members as "Members" rather than "my digital humans" and has no way
into the team view; Answer opens it where the decision is answered, and member
reports in the conversation link to it. The progress canvas of a temporary team
carries the same tag and the action to keep the team (then to open the saved one).
Its members, like the bar's, are read from the task board, and a collaborator shows
its given name rather than the id-suffixed handle it is addressed by
(`memberDisplayName`). A temporary team's lead
may hand work out by message alone; while its board is empty, each member the lead
wrote to is one subtask (`delegatedTasks`), done once the member has answered the
lead's latest message and is not at work. Until then it is titled by the lead's first
message; once done, by the opening line of the member's report. Such subtasks keep
the order the work was handed out, since it usually passed from one member to the
next. This reading
feeds the bar and the canvas alike, so both settle to completed together; a board
task, once there is one, replaces it.
The Teams workbench retains its original composer selector and member rail.
Member details remain an explicit action in team management.
The client remembers the last task per team and member choice per task. An
explicit decision entry instead selects the relevant member and question.
Management workbench guidance explains task scope and links to active tasks. Member work
links navigate to that task and, when owned, that member; status does not inject
another task's context into the current conversation.
Internal member conversations expose the latest execution as a row below
collaboration messages, open while it runs, with the existing thought/tool
rendering inline at full width under the row's own status (no second frame).
Human-facing conversations use their normal process display without a duplicate
status row. Completed internal execution stays collapsed; older rounds remain in
execution history. Task activity can drill into a member's execution inputs, persisted results and live work using
the existing thought/tool components. Read-only state snapshots recover local
work already in flight; remote work uses the existing stream and replicated
history. Missing execution events are reported as unavailable, not interpreted as
a stalled agent. Conversation subscriptions are reference-counted across mounted
views so closing an inspector does not unsubscribe the chat beneath it.

Decision requests occupy their creation time in the member conversation. Their
request and answer are also append-only team activities, so every teammate sees
the blocking question and its resolution while only the digital human's owner
receives controls. Another person's decision never enters the viewer's "Needs my
decision" group. A fixed
composer reminder locates unanswered requests, switching the owned member when
needed. Answered cards retain the answer and timestamp with an expandable original
question. The activity store supplies this history after reopening; pending team
detail supplies immediate requests, and response events update the same records.
When a tool receipt identifies the request, its card follows that turn's thought
panel, before the persisted reply. Live requests follow the streaming work;
unmatched historical requests retain their own timestamp position.

Task rooms contain human exchanges with the selected member, interleaved
with compact coordination segments. Only directed messages involving that member
in the selected task qualify; prior collaboration does not expose unrelated acts.
Consecutive coordination is grouped between human exchanges, collapsed by default,
with the latest three messages on expansion and a link into full task activity.
Delivery failures remain visible. A member's conversation becomes human-facing
from its first human input in that task: later assistant results remain in the
conversation even when a teammate or system notification resumes the work.
Earlier internal results are not backfilled, and other member/task histories do
not confer this audience. Raw team inputs remain outside human message bubbles.
Internal assistant results from conversations without human input and shared
board records stay in task activity. Actual system inputs (turn-end reports,
periodic checks and run starts) appear there as collapsed notification records,
with consecutive notices grouped per recipient and full input text on expansion.
Human-facing results are not duplicated in task activity.
A record's text is shown whole when short; longer text shows its first three lines as
plain text (Markdown marks dropped, line breaks kept) and opens in place into the
rendered whole, rendered only once opened, with Collapse below it.
Activity groups are newest first by their latest record; expanded groups and
conversation coordination previews retain chronological order. Interacting with
the activity history holds its visible records steady; newly arriving records
are revealed through an explicit update button instead of shifting the reader.
The workbench room and drawer share one task board read; live events merge into that board.
The transcript trigger carries team origin and correlation; display routing uses
that provenance only, never message text. Invalid timestamps retain their records
with an unknown-time label and sort after dated records. Activity loads member reports on demand with
bounded concurrency and refreshes them on history notifications. A missing
report is shown as unavailable rather than silently treated as empty: a warning
names the members when they left a trace in the task or failed while reachable;
otherwise a quiet line names the offline computers. A message that did not arrive
is drawn as that message, sender to recipient, with whom it was for, what their
computer is doing now and what can be done. Failed receipts retain their reason
in the activity details; being online never implies successful delivery.
Task grouping prioritizes the human creator over member involvement. Completion
is a filter/status within that relationship, not a separate destination.

## History resources and rendering limits

`team/session-history.ts` shares a transcript between chat, member reports and
the execution inspector. The first explicit read uses the existing full-history
API; subsequent reads merge the changed sequence tail while a reader remains
mounted. The last reader releases the retained transcript.
`workbench/execution-state.ts` similarly shares one polling loop per execution
and stops it when the last observer leaves.

The conversation renders 50 rows per page, task activity renders 50 groups per
page with at most 20 records per group, and execution history renders 30 turns
per page. These are DOM limits, not server-side history pagination: opening a
large history still incurs its initial full response and in-memory projection.
The team detail's 500-record live window is a refresh buffer, not the complete
selected task history.

## Work-scoped collaborators

The selected board supplies its own members and roster. `detailForTask` combines
that snapshot with team configuration only when both team and epoch match. The
projection is local to the task room, member rail, activity, decisions and history;
standing team settings always receive the original permanent roster. A temporary
participant's details open its work execution instead of a permanent-person editor.
A local participant needs an explicit local workspace before its composer is
editable; a remote participant remains read-only.

Task switches retain a requested or remembered member until the matching board
arrives, then validate it against that roster. Member and status notifications
refresh only the selected work's `EpochRoster`, with a short burst coalescing
window and one request in flight. They never reread activity, tasks or findings.
Full-board reads occur on entry, explicit retry or a gap in the activity buffer.
A later membership snapshot survives an older full-board response; requests from
a prior selection cannot replace the current roster. A missing roster from an
older server retains the standing projection;
an explicitly empty roster stays empty.

A standing goal is optional. Manual team creation accepts an empty goal; AI roster
proposals still require a concrete brief. Empty goals have no header popover, and
starting work without one opens a new task for the user's instructions. Editable
settings retain the optional goal field so it can be added later.
