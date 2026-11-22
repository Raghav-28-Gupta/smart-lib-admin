'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useState } from 'react'
import { AdjustReliabilityDialog } from '@/components/students/AdjustReliabilityDialog'
import { HistoryTables } from '@/components/students/HistoryTables'
import { ReliabilityCard } from '@/components/students/ReliabilityCard'
import { StudentHeader } from '@/components/students/StudentHeader'
import { StudentError, StudentNotFound, StudentSkeleton } from '@/components/students/StudentStates'
import { useWriteAction } from '@/components/useWriteAction'
import { ApiError } from '@/lib/api'
import { useLiveRefresh } from '@/lib/liveContext'
import { useActiveHref, usePageTitle } from '@/lib/pageTitle'
import { adjustReliability, fetchStudent, studentSection, type AdminStudent } from '@/lib/students'
import { useLoader } from '@/lib/useLoader'

// useSearchParams only knows the query at request time, so a page that reads it must sit under a Suspense boundary or
// `next build` fails while prerendering. useParams goes inside too: for a dynamic segment it can suspend the same way.
export default function StudentPage() {
  return (
    <Suspense fallback={<StudentSkeleton />}>
      <StudentRoute />
    </Suspense>
  )
}

function StudentRoute() {
  const params = useParams<{ id: string }>()
  const from = useSearchParams().get('from')
  const id = typeof params?.id === 'string' ? params.id : ''
  // Keyed by id, so another student starts from the skeleton instead of showing the last one for a frame.
  return <StudentView key={id} id={id} from={from} />
}

function StudentView({ id, from }: { id: string; from: string | null }) {
  const section = studentSection(from)

  // A 404 is an answer, not a failure: it loads as null so the page can say "Student not found" instead of offering a Retry.
  const fetcher = useCallback(async (): Promise<AdminStudent | null> => {
    if (!id) return null
    try {
      return await fetchStudent(id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }, [id])
  const { state, refresh, retry } = useLoader(fetcher)
  // Everything that could change what this page shows: fines, loans and copies (catalogue), bookings and room requests, the score.
  useLiveRefresh(['fines', 'catalogue', 'bookings', 'requests', 'students'], () => void refresh())

  const student = state.kind === 'loaded' ? state.data : null
  // The top bar reads "Fines / Aditi Sharma" and the sidebar keeps Fines highlighted; until the name is known it is the section alone.
  usePageTitle(student ? `${section.label} / ${student.name}` : section.label)
  useActiveHref(section.href)

  const [adjusting, setAdjusting] = useState(false)
  const close = useCallback(() => setAdjusting(false), [])
  const { busy, run } = useWriteAction(refresh)
  // The dialog stays open, with what was typed, until the write has gone through; a refusal is toasted and the librarian fixes it.
  const adjust = async (delta: number, reason: string) => {
    const saved = await run(() => adjustReliability(id, delta, reason), 'Reliability adjusted.')
    if (saved) close()
    return saved
  }

  if (state.kind === 'loading') return <StudentSkeleton />
  if (state.kind === 'error') return <StudentError onRetry={retry} />
  if (!student) return <StudentNotFound />

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 920 }}>
        <StudentHeader student={student} busy={busy} onAdjust={() => setAdjusting(true)} />
        <ReliabilityCard student={student} />
        <HistoryTables student={student} />
      </div>
      {adjusting && <AdjustReliabilityDialog currentScore={student.score} onCancel={close} onConfirm={adjust} />}
    </>
  )
}
