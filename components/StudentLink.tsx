import Link from 'next/link'
import { studentHref, type StudentFrom } from '@/lib/students'

/**
 * A student's name as a link to their page, in the canvas's student-link style: accent-700, underlined, at the
 * surrounding font size. `from` names the section it sits in, so the student page's breadcrumb and sidebar
 * can lead back there. The name is a text child: React escapes it. `prefetch={false}`: the student page is a
 * dynamic route rendered on demand (it loads its data on the client), so Next's default prefetch would cost one
 * server render for every visible name.
 */
export function StudentLink({ student, from }: { student: { id: string; name: string }; from: StudentFrom }) {
  return (
    <Link
      href={studentHref(student.id, from)}
      prefetch={false}
      style={{ color: 'var(--color-accent-700)', textDecoration: 'underline', fontSize: 'inherit' }}
    >
      {student.name}
    </Link>
  )
}
