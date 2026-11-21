import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css';
import './inspection.css';
import './workspace-theme.css';
import './print-workspace.css';
import { ProjectProvider } from '@/lib/project-store'

const geist = localFont({
  src: './fonts/Geist-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist',
})

export const metadata: Metadata = {
  title: 'AutoBuild AI',
  description: 'AI-powered quality control for 3D concrete printing',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-workspace-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('autobuild_workspace_theme')==='light')document.documentElement.dataset.workspaceTheme='light'}catch{}" }} />
        <link rel="icon" href="/favicon.ico" sizes="any"/>
      </head>
      <body className={`${geist.variable} flex flex-col min-h-screen`}>
        <ProjectProvider>
          <div className="flex-1">
            {children}
          </div>
        </ProjectProvider>
      </body>
    </html>
  )
}