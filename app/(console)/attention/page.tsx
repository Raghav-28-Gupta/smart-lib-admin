'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useState } from 'react'
import { AttentionCard } from '@/components/attention/AttentionCard'
import { AttentionEmpty, AttentionError, AttentionFilterEmpty, AttentionSkeleton } from '@/components/attention/AttentionStates'
import { ConfirmCopyReportDialog } from '@/components/attention/ConfirmCopyReportDialog'
import { DismissDialog } from '@/components/attention/DismissDialog'
import { EscalateDialog } from '@/components/attention/EscalateDialog'
import { RemindDialog } from '@/components/attention/RemindDialog'
import { OverturnNoShowDialog } from '@/components/attention/OverturnNoShowDialog'
import { StudentWords } from '@/components/attention/StudentWords'
import { UpholdDialog } from '@/components/attention/UpholdDialog'
import { UpholdNoShowDialog } from '@/components/attention/UpholdNoShowDialog'
import { useAttentionActions } from '@/components/attention/useAttentionActions'
import { AdjustFineDialog } from '@/components/fines/AdjustFineDialog'
import { OfflineDialog } from '@/components/resources/OfflineDialog'
import {
  ATTENTION_KINDS, fineFromDispute,
  type AttentionKind, type FineDisputeItem, type NoShowDisputeItem, type OverdueItem, type ReportItem,
} from '@/lib/attention'
import { useAttention } from '@/lib/attentionContext'

type Filter = 'all' | AttentionKind

// The dialog holds the item as the librarian opened it, not the live list's: a refusal refetches, and the card may be
// gone by then (the loan was returned, the dispute was resolved, the report was closed), but the dialog stays up with what
// was typed until the librarian cancels or retries.
type OpenDialog =
  | null
  | { kind: 'remind' | 'escalate'; item: OverdueItem }
  | { kind: 'adjust' | 'uphold'; item: FineDisputeItem }
  | { kind: 'overturnNoShow' | 'upholdNoShow'; item: NoShowDisputeItem }
  | { kind: 'confirmCopy' | 'takeOffline' | 'dismiss'; item: ReportItem }

// The canvas's order. `value` is a kind from ATTENTION_KINDS or the pseudo-kind 'all' (which is why the known-kinds filter below
// reads ATTENTION_KINDS and not this list).
const CHIPS: { value: Filter; label: string; plural: string }[] = [
  { value: 'all', label: 'All', plural: 'items' },
  { value: 'overdue', label: 'Overdue follow-ups', plural: 'overdue follow-ups' },
  { value: 'fine_dispute', label: 'Fine disputes', plural: 'fine disputes' },
  { value: 'no_show_dispute', label: 'No-show disputes', plural: 'no-show disputes' },
  { value: 'report', label: 'Maintenance flags', plural: 'maintenance flags' },
]

/** `?type=` names a chip; anything else (missing, misspelt, `constructor`) is All. */
function filterFor(type: string | null): Filter {
  return CHIPS.find((chip) => chip.value === type)?.value ?? 'all'
}

// useSearchParams only knows the query at request time, so a page that reads it must sit under a Suspense boundary or
// `next build` fails while prerendering.
export default function AttentionPage() {
  return (
    <Suspense fallback={<AttentionSkeleton />}>
      <AttentionRoute />
    </Suspense>
  )
}

function AttentionRoute() {
  return <AttentionView type={useSearchParams().get('type')} />
}

function AttentionView({ type }: { type: string | null }) {
  const { state, refresh, retry } = useAttention()
  const actions = useAttentionActions(refresh)
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const close = useCallback(() => setDialog(null), [])
  // A dialog stays open, with what was typed, until its write has gone through; a refusal is toasted and the librarian decides.
  const closeWhenSent = async (write: Promise<boolean>) => {
    const sent = await write
    if (sent) close()
    return sent
  }
  const [filter, setFilter] = useState<Filter>(() => filterFor(type))
  // A link to /attention?type=overdue followed while this page is open changes the query without remounting it:
  // the chip follows the URL whenever the URL changes, and is the librarian's own choice in between.
  const [seenType, setSeenType] = useState(type)
  if (type !== seenType) {
    setSeenType(type)
    setFilter(filterFor(type))
  }

  if (state.kind === 'loading') return <AttentionSkeleton />
  if (state.kind === 'error') return <AttentionError onRetry={retry} />

  const { counts, emailEnabled } = state.data
  // A kind this console does not know (a newer server's) has no card to draw: leave it out rather than fail the page.
  // `counts` is the server's, so All and the sidebar badge still count it until this console learns the kind.
  const items = state.data.items.filter((item) => ATTENTION_KINDS.some((kind) => kind === item.kind))
  const shown = filter === 'all' ? items : items.filter((item) => item.kind === filter)

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`tag sla-chip ${filter === chip.value ? 'tag-accent' : 'tag-neutral'}`}
            aria-pressed={filter === chip.value}
            onClick={() => setFilter(chip.value)}
          >
            {`${chip.label} (${counts[chip.value] ?? 0})`}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <AttentionEmpty />
      ) : shown.length === 0 ? (
        <AttentionFilterEmpty what={CHIPS.find((chip) => chip.value === filter)!.plural} onClear={() => setFilter('all')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((item) => (
            <AttentionCard
              key={`${item.kind}:${item.id}`}
              item={item}
              busy={actions.busy}
              onRemind={(overdue) => setDialog({ kind: 'remind', item: overdue })}
              onEscalate={(overdue) => setDialog({ kind: 'escalate', item: overdue })}
              onAdjust={(dispute) => setDialog({ kind: 'adjust', item: dispute })}
              onUphold={(dispute) => setDialog({ kind: 'uphold', item: dispute })}
              onOverturnNoShow={(noShow) => setDialog({ kind: 'overturnNoShow', item: noShow })}
              onUpholdNoShow={(noShow) => setDialog({ kind: 'upholdNoShow', item: noShow })}
              onConfirmCopy={(report) => setDialog({ kind: 'confirmCopy', item: report })}
              onTakeOffline={(report) => setDialog({ kind: 'takeOffline', item: report })}
              onDismiss={(report) => setDialog({ kind: 'dismiss', item: report })}
            />
          ))}
        </div>
      )}

      {dialog?.kind === 'remind' && (
        <RemindDialog
          item={dialog.item}
          emailEnabled={emailEnabled}
          onCancel={close}
          onConfirm={() => closeWhenSent(actions.remind(dialog.item))}
        />
      )}
      {dialog?.kind === 'escalate' && (
        <EscalateDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(note) => closeWhenSent(actions.escalate(dialog.item, note))}
        />
      )}
      {dialog?.kind === 'adjust' && (
        <AdjustFineDialog
          fine={fineFromDispute(dialog.item)}
          context={<StudentWords label="The student's reason" words={dialog.item.dispute.studentReason} />}
          onCancel={close}
          onConfirm={(amount, reason) => closeWhenSent(actions.adjust(dialog.item, amount, reason))}
        />
      )}
      {dialog?.kind === 'uphold' && (
        <UpholdDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(note) => closeWhenSent(actions.uphold(dialog.item, note))}
        />
      )}
      {dialog?.kind === 'overturnNoShow' && (
        <OverturnNoShowDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(reason) => closeWhenSent(actions.overturnNoShow(dialog.item, reason))}
        />
      )}
      {dialog?.kind === 'upholdNoShow' && (
        <UpholdNoShowDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(note) => closeWhenSent(actions.upholdNoShow(dialog.item, note))}
        />
      )}
      {dialog?.kind === 'confirmCopy' && (
        <ConfirmCopyReportDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(outcome, note) => closeWhenSent(actions.confirmCopy(dialog.item, outcome, note))}
        />
      )}
      {dialog?.kind === 'takeOffline' && (
        // The slice 4 dialog, started with the student's own words. The queue names the resource but does not count its
        // bookings, so the dialog leaves that sentence out.
        <OfflineDialog
          resource={{ name: dialog.item.report.resource?.name ?? 'This resource' }}
          initialNote={dialog.item.report.note ?? ''}
          onCancel={close}
          onConfirm={(note) => closeWhenSent(actions.takeResourceOffline(dialog.item, note))}
        />
      )}
      {dialog?.kind === 'dismiss' && (
        <DismissDialog
          item={dialog.item}
          onCancel={close}
          onConfirm={(note) => closeWhenSent(actions.dismiss(dialog.item, note))}
        />
      )}
    </>
  )
}
