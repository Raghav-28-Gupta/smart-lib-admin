# SmartLib — Admin Console (Next.js)

The librarian console. It talks only to the Node backend (`../backend`), using
the same login API as the student app, and admits accounts with the admin role.

## Commands (run from `admin/`)

```bash
npm run dev        # http://localhost:3001 (needs the backend on :3000)
npm test           # Vitest + Testing Library, no backend needed
npm run build      # production build, includes type-checking
```

## Conventions

- Every page is a client component: the session token lives in `localStorage`
  (`smartlib.admin.token`), so nothing fetches on the server.
- All API calls go through `lib/api.ts`. A 401 or 403 there ends the session;
  `ConsoleGuard` (`lib/session.tsx`) sends the user to `/login` with the reason.
- Styling comes from the Organic design system (`styles/ds.css`, kept verbatim
  apart from fonts) and the canvas's console rules (`styles/console.css`). Use
  its classes (`card`, `btn`, `input`, `text-muted`, `sla-*`) before adding CSS.
- Icons: `lucide-react` at `strokeWidth={2.75}`.
- Copy follows the spec in `docs/`; don't paraphrase user-facing strings.
- Tests live in `test/`, mirroring the source tree. Mock `fetch` with
  `test/helpers.ts`; mock `next/navigation` and `next/link` per test file. Give
  the mocked `useRouter` a stable `replace` (hoisted, not a new `vi.fn()` per
  render): `ConsoleGuard`'s effect depends on it and would re-run forever.
- Live updates come from `lib/liveContext.tsx`: refetch with
  `useLiveRefresh(topics, refetch)` or react with `useLiveMessages`. Never poll.
- Pending requests live in `RequestsProvider` (`lib/requestsContext.tsx`); read
  them with `useRequests()` instead of fetching them again. It also holds the list's
  order (`order`, `setOrder`: `'suggested'`, the server's default and what a plain
  `GET /admin/requests` returns, or `'request'` for the Requests page's "By request
  time" toggle, which sends `?order=request`); an order change refetches quietly, the
  counts never depend on it, and the page puts it back to `'suggested'` when it
  unmounts. A scored room request carries `room.priority`
  (`{ suggestedDelayMinutes, riskPercent }`); `suggestedOrderNote(r)`
  (`components/requests/requestText.ts`) words it only when the delay is above zero,
  and `RequestCard` takes a required `showOrderNote` that the page turns off under
  `order === 'request'` (the note would contradict the list). The Dashboard's
  `WaitingPanel` sorts a copy of the list by `requestedAt` itself before taking its
  first three, because the provider's array is in the suggested order.
- The Needs attention queue lives in `AttentionProvider` (`lib/attentionContext.tsx`), mounted next to it in the console
  layout: read it with `useAttention()`; the sidebar badge is `attentionCount(state)` (`counts.all`). `AttentionItem`
  (`lib/attention.ts`) is a union on `kind` (`overdue`, `fine_dispute`, `report`, `no_show_dispute`; `ATTENTION_KINDS` is the one
  list of them, and the page leaves out an item of any other kind); `counts` has a required `no_show_dispute` too (an older
  backend would not send it, so the page reads a missing count as 0: the backend deploys first). The page filters its chips client-side
  (the console never sends the API's `?kind=`) and reads `?type=` (the page's name for the same word) inside `<Suspense>`.
  The overdue card's line ("Reminded 2 days ago · emailed") is `noticeLine`: a notice's `emailStatus` `sent` reads
  "emailed", `failed` and `skipped` both read "not emailed", and one under a minute old reads "just now".
  `useAttentionActions(refresh)` (`components/attention/`) returns `remind`, `escalate`, `uphold`, `adjust`, `confirmCopy`,
  `takeResourceOffline`, `dismiss`, `overturnNoShow` and `upholdNoShow`; `fineFromDispute(item)` builds the `AdminFine` the reused
  `AdjustFineDialog` needs. A no-show dispute is answered through `POST /admin/no-show-disputes/:id/overturn` (a reason, required)
  and `/uphold` (an optional note), both named by the dispute's `noShow.disputeId`; the student's words are shown through
  `StudentWords` (`white-space: pre-line`, so the line breaks they typed survive, as in the fine dispute card).
  A resource report's "Take offline" is `confirmReport(id, { note })` with no `outcome`: the server takes the resource
  offline and closes the report in that one request (it is not the Resources page's offline route).
- Live topics (`LiveTopic` in `lib/live.ts`) are `requests`, `metrics`,
  `bookings`, `resources`, `fines`, `catalogue`, `students` and `attention`
  (`LiveEventType` also lists `request.scored`, a room request the model just scored,
  on `requests`). Each page
  refetches on its own: Requests (and the sidebar count) on `requests`, Needs attention
  (and its sidebar count) on `attention` (`attention.changed`; a past-due `loan.changed` and a
  lost-on-loan `catalogue.changed` carry the topic too), the
  Dashboard on `metrics`, Bookings on `bookings` (`booking.changed`), Resources on
  `resources` (`resource.changed`), Fines on `fines` (`fine.changed`, and
  `loan.changed` for a past-due return), Catalogue on `catalogue`
  (`catalogue.changed`, `loan.changed`) and `requests` (a pending borrow request
  holds a copy), and the student page on `fines`, `catalogue`, `bookings`,
  `requests` and `students` (`student.changed`). A new topic must be added to
  `lib/live.ts` and to the page that should react to it.
- `apiRequest` takes `GET`, `POST` and `PATCH`.
- Dialogs use the shared `components/Dialog.tsx`: backdrop, `role="dialog"`,
  Escape to cancel, Tab kept inside, focus handed back to the opener. It does
  not move focus into itself: `autoFocus` the first field, or the primary button
  when there is nothing to fill in.
- Every write action goes through `useWriteAction` (`components/useWriteAction.ts`),
  never a bare `apiRequest` in a handler: `run(action, successMessage)` ignores a
  second call while one is in flight (a ref guard), toasts the success message or
  the `ApiError` message (nothing on a 401 or 403, which ends the session), and
  stays `busy` until the latest `refresh` has returned. Disable the row's buttons
  with `busy`. Wrap it per page (`useBookingAction`, `useResourceActions`,
  `useFineActions`, `useCatalogueActions`, `useAttentionActions`; the student page calls it directly).
  `run` resolves `true` when the action succeeded and `false` when it failed or was
  ignored as a second call; callers that do not care just `void` it. A dialog with
  typed values (the Catalogue's book, copies, lost-on-loan and restore dialogs, the student page's adjust dialog)
  stays open until `run` resolves `true`, so a refusal does not throw the form away (`components/useDialogSubmit.ts`).
  The Fines page's two dialogs close as soon as they are confirmed (their row buttons stay off through `busy`): a refused
  adjust or Mark paid is read from the toast and the refetched row, because the dialog only holds the row as it was.
  `AdjustFineDialog`'s `onConfirm` may instead return `Promise<boolean>` (the Needs attention dispute card does): the dialog
  then stays open with what was typed until it resolves `true`, and Save is off while the write is in flight. So may
  `OfflineDialog`'s (the Needs attention "Take offline" does; the Resources page's still closes on confirm), which has
  three optional props for that page: `initialNote` (the note box starts with the student's words), `resource.upcomingBookings`
  (without it the "n upcoming bookings stay" sentence is left out) and the promise-returning `onConfirm`.
  The Needs attention dialogs (`RemindDialog`, `EscalateDialog`, `UpholdDialog`, `ConfirmCopyReportDialog`, `DismissDialog`,
  `OverturnNoShowDialog`, `UpholdNoShowDialog` and those two) all use `useDialogSubmit`: the page holds the item as it was opened and closes a dialog only once its write
  resolves `true` (`closeWhenSent`), so a refusal that refetches the card away still keeps the dialog and its text.
  A fine with an open dispute carries `dispute` (`AdminFine`): its row shows the Disputed tag and the student's reason, hides
  Mark paid, and `adjustFine(id, amount, reason, disputeId)` names that dispute so the server closes it with the adjustment.
  `success` may be a function of the action's result when the toast depends on the
  server's answer (Restore says whether the replacement charge was waived).
- A list page that fetches its own data uses `useLoader(fetcher)`
  (`lib/useLoader.ts`): `{ state, refresh, retry }`, where a new fetcher or
  `retry()` shows the skeleton and `refresh()` is quiet (the rows stay on screen,
  even if it fails). Keep the fetcher stable: a module-level function, or
  `useCallback` over the query it closes over, or it refetches on every render.
  Pair it with `useLiveRefresh(topics, () => void refresh())`.
- A list page with search, a status filter and paging uses `useListQuery(fetchPage, rowCount)`
  (`lib/useListQuery.ts`) instead of wiring `useLoader` itself: it owns the debounced search, the
  status, the page, `clearFilters`, `pastEnd` (the page asked for is gone) and the loader's
  `{ state, refresh, retry }`. Bookings and Fines use it, and the Catalogue without a status (leave
  `Status` out for a search-only page).
- A paged list ends with `components/Pager.tsx` (`page`, `pageSize`, `total`, `onPage`): Previous, "Page 2 of 3"
  and Next, disabled at the ends, and nothing when one page holds everything. The "x–y of N" count above it is
  `pageRange` (`lib/format.ts`).
- The loading, error, no-match and empty blocks of a list page come from the
  shared `components/StateBlocks.tsx`; each page only words them (see
  `ResourcesStates.tsx`, `BookingsStates.tsx`).
- A student's name in a table row, card or copy chip is a `components/StudentLink.tsx` (`<StudentLink student
  from="fines" />`), not plain text (a sentence in a dialog just uses the name): `from` names the section it sits
  in (`StudentFrom` in `lib/students.ts`: `bookings`, `fines`, `requests`, `catalogue`, `attention`), so the student page's
  breadcrumb and highlighted sidebar section lead back there.
- The layout titles a page and highlights its sidebar section from the path (`PAGE_TITLES`, `Sidebar`'s
  `activeHref`). A page the path cannot describe (`/students/<id>?from=fines`) sets both itself with
  `usePageTitle(title)` and `useActiveHref(href)` (`lib/pageTitle.tsx`); both reset when the page unmounts.
- A page that reads `useSearchParams` (or `useParams` on a dynamic segment) renders it inside `<Suspense>`, as
  the login and student pages do, or `next build` fails while prerendering.
- Never commit for the user: present `git add`/`git commit` commands (prefix `admin:`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
