import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { NextAuthProvider } from './session-provider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
	title: 'DKIM Lookup',
	description: 'DKIM archive website',
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang="en">
			<NextAuthProvider>
				<body className={inter.className}>{children}</body>
			</NextAuthProvider>
		</html>
	)
}
