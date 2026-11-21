'use client'

import { useCallback, useState } from 'react'
import { BookingsTable } from '@/components/bookings/BookingsTable'
import { BookingsEmpty, BookingsError, BookingsFilterEmpty, BookingsSkeleton } from '@/components/bookings/BookingsStates'
import { CancelBookingDialog } from '@/components/bookings/CancelBookingDialog'
import { ReassignDialog } from '@/components/bookings/ReassignDialog'
import { useBookingAction } from '@/components/bookings/useBookingAction'
import { Pager } from '@/components/Pager'
import { BOOKING_STATUS_FILTERS, bookingsRange, fetchBookings, type AdminBooking, type BookingsPage as BookingsResponse, type BookingStatus } from '@/lib/bookings'
import { useLiveRefresh } from '@/lib/liveContext'
import { useListQuery } from '@/lib/useListQuery'

type OpenDialog = null | { kind: 'cancel' | 'reassign'; booking: AdminBooking }

export default function BookingsPage() {
  const { state, data, refresh, retry, searchInput, setSearchInput, status, setStatus, setPage, pastEnd, filtered, clearFilters } =
    useListQuery<BookingsResponse, BookingStatus>(fetchBookings, (reply) => reply.bookings.length)
  useLiveRefresh(['bookings'], () => void refresh())

  const [dialog, setDialog] = useState<OpenDialog>(null)
  const actions = useBookingAction(refresh)
  const close = useCallback(() => setDialog(null), [])

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="Search bookings"
          placeholder="Search student or resource"
          maxLength={100}
          style={{ maxWidth: 240 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="input"
          aria-label="Filter by status"
          style={{ maxWidth: 170 }}
          value={status}
          onChange={(e) => setStatus(e.target.value as BookingStatus | 'all')}
        >
          {BOOKING_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {data && !pastEnd ? bookingsRange(data.page, data.pageSize, data.total) : ''}
        </span>
      </div>

      {state.kind === 'loading' || pastEnd ? (
        <BookingsSkeleton />
      ) : state.kind === 'error' ? (
        <BookingsError onRetry={retry} />
      ) : state.data.bookings.length === 0 ? (
        filtered ? <BookingsFilterEmpty onClear={clearFilters} /> : <BookingsEmpty />
      ) : (
        <>
          <BookingsTable
            bookings={state.data.bookings}
            busy={actions.busy}
            onReassign={(booking) => setDialog({ kind: 'reassign', booking })}
            onCancel={(booking) => setDialog({ kind: 'cancel', booking })}
          />
          <Pager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />
        </>
      )}

      {dialog?.kind === 'cancel' && (
        <CancelBookingDialog
          booking={dialog.booking}
          onCancel={close}
          onConfirm={(reason) => {
            close()
            void actions.cancel(dialog.booking, reason)
          }}
        />
      )}
      {dialog?.kind === 'reassign' && (
        <ReassignDialog
          booking={dialog.booking}
          onCancel={close}
          onConfirm={(target) => {
            close()
            void actions.reassign(dialog.booking, target)
          }}
        />
      )}
    </>
  )
}
