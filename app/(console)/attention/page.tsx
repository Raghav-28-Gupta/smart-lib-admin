'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useState } from 'react'
import { AttentionCard } from '@/components/attention/AttentionCard'
import { AttentionEmpty, AttentionError, AttentionFilterEmpty, AttentionSkeleton } from '@/components/attention/AttentionStates'
import { EscalateDialog } from '@/components/attention/EscalateDialog'
import { RemindDialog } from '@/components/attention/RemindDialog'
import { useAttentionActions } from '@/components/attention/useAttentionActions'
import type { AttentionKind, OverdueItem } from '@/lib/attention'
import { useAttention } from '@/lib/attentionContext'

type Filter = 'all' | AttentionKind

// The dialog holds the item as the librarian opened it, not the live list's: a refusal refetches, and the card may be
// gone by then (the loan was returned), but the dialog stays up with its note until the librarian cancels or retries.
type OpenDialog = null | { kind: 'remind' | 'escalate'; item: OverdueItem }

// No No-show chip: the canvas had one, but a no-show dispute is not part of this queue.
const CHIPS: { value: Filter; label: string; plural: string }[] = [
  { value: 'all', label: 'All', plural: 'items' },
  { value: 'overdue', label: 'Overdue follow-ups', plural: 'overdue follow-ups' },
  { value: 'fine_dispute', label: 'Fine disputes', plural: 'fine disputes' },
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

  const { items, counts, emailEnabled } = state.data
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
            {`${chip.label} (${counts[chip.value]})`}
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
    </>
  )
}
