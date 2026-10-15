import type { Metadata } from 'next'
import { Caprasimo, Figtree } from 'next/font/google'
import type { ReactNode } from 'react'
import '@/styles/ds.css'
import '@/styles/console.css'

const caprasimo = Caprasimo({ weight: '400', subsets: ['latin'], variable: '--font-caprasimo' })
const figtree = Figtree({ weight: ['400', '600', '700'], subsets: ['latin'], variable: '--font-figtree' })

export const metadata: Metadata = {
  title: 'SmartLib Admin',
  description: 'Librarian console for SmartLib.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable}`}>
      <body>{children}</body>
    </html>
  )
}
