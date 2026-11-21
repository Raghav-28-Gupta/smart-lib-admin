import { ChevronLeft, ChevronRight } from 'lucide-react'

const button = { padding: '4px 10px', fontSize: 12 }
const icon = { verticalAlign: -2 }

/** Previous and Next with "Page 2 of 3"; both disable at the ends. Nothing when one page holds it all. */
export function Pager({
  page, pageSize, total, onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null
  return (
    <nav aria-label="Pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
      <button type="button" className="btn btn-ghost" style={button} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} strokeWidth={2.75} aria-hidden="true" style={icon} />
        Previous
      </button>
      <span className="text-muted" style={{ fontSize: 12 }}>{`Page ${page} of ${pageCount}`}</span>
      <button type="button" className="btn btn-ghost" style={button} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight size={14} strokeWidth={2.75} aria-hidden="true" style={icon} />
      </button>
    </nav>
  )
}
