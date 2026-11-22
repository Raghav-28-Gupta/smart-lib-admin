import { UserX } from 'lucide-react'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlocks'

export function StudentSkeleton() {
  return <LoadingBlock label="Loading student" height={400} />
}

export function StudentError({ onRetry }: { onRetry: () => void }) {
  return <ErrorBlock title="Couldn't load this student" onRetry={onRetry} />
}

/** The server said 404: no student has this id, or it belongs to an admin account. Retrying would change nothing. */
export function StudentNotFound() {
  return <EmptyBlock icon={UserX} title="Student not found" />
}
