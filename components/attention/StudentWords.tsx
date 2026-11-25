import type { CSSProperties } from 'react'

// `pre-line` keeps the line breaks the student typed (a textarea allows them) and still wraps a long line.
const wordsStyle: CSSProperties = { fontSize: 13, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }

/**
 * The student's own words (a dispute's reason, a report's note) in full, for a dialog the librarian decides in, and on the
 * no-show dispute card. They are text, never markup, and are not cut short: up to 300 characters, a few lines, each line
 * break kept. `label` says whose words they are.
 */
export function StudentWords({ label, words }: { label: string; words: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="text-muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={wordsStyle}>{words}</div>
    </div>
  )
}
