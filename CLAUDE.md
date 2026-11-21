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
  them with `useRequests()` instead of fetching them again.
- Live topics (`LiveTopic` in `lib/live.ts`) are `requests`, `metrics`,
  `bookings` and `resources`. The Bookings page refetches on `bookings`
  (`booking.changed`), the Resources page on `resources` (`resource.changed`).
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
  with `busy`. Wrap it per page (`useBookingAction`, `useResourceActions`).
- A list page that fetches its own data uses `useLoader(fetcher)`
  (`lib/useLoader.ts`): `{ state, refresh, retry }`, where a new fetcher or
  `retry()` shows the skeleton and `refresh()` is quiet (the rows stay on screen,
  even if it fails). Keep the fetcher stable: a module-level function, or
  `useCallback` over the query it closes over, or it refetches on every render.
  Pair it with `useLiveRefresh(topics, () => void refresh())`.
- A list page with search, a status filter and paging uses `useListQuery(fetchPage, rowCount)`
  (`lib/useListQuery.ts`) instead of wiring `useLoader` itself: it owns the debounced search, the
  status, the page, `clearFilters`, `pastEnd` (the page asked for is gone) and the loader's
  `{ state, refresh, retry }`. Bookings and Fines use it; leave `Status` out for a search-only page.
- The loading, error, no-match and empty blocks of a list page come from the
  shared `components/StateBlocks.tsx`; each page only words them (see
  `ResourcesStates.tsx`, `BookingsStates.tsx`).
- Never commit for the user: present `git add`/`git commit` commands (prefix `admin:`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
