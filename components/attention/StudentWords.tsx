import type { CSSProperties } from 'react'

const wordsStyle: CSSProperties = { fontSize: 13, overflowWrap: 'anywhere' }

/**
 * The student's own words (a dispute's reason, a report's note) in full, for a dialog the librarian decides in. They are
 * text, never markup, and are not cut short: up to 300 characters, a few lines. `label` says whose words they are.
 */
export function StudentWords({ label, words }: { label: string; words: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="text-muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={wordsStyle}>{words}</div>
    </div>
  )
}
