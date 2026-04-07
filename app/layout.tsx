import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ProjectProvider } from '@/lib/project-store'
import Footer from '@/components/Footer'

const inter = Inter({ 
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AutoBuild AI',
  description: 'AI-powered quality control for 3D concrete printing',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} flex flex-col min-h-screen`}>
        <ProjectProvider>
          <div className="flex-1">
            {children}
          </div>
          <Footer />
        </ProjectProvider>
      </body>
    </html>
  )
}