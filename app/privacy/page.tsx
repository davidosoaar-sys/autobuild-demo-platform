'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-bold text-black mb-3 uppercase tracking-widest">{title}</h2>
      <div className="text-sm text-black/60 leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  const router = useRouter();
  const effective = 'April 18, 2026';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-1 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="text-sm text-black/40 hover:text-black transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <div className="h-6 w-px bg-gray-200"/>
          <div className="-my-4 sm:-my-5">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-xs text-black/35">AutoBuild AI · Effective {effective}</p>
        </div>

        <div className="bg-black text-white rounded-2xl px-5 py-4 mb-8 text-xs leading-relaxed">
          This Privacy Policy explains how AutoBuild AI collects, uses, and protects information in connection with your use of the platform.
        </div>

        <Section title="1. What We Collect">
          <p>AutoBuild AI collects the following categories of data when you use the platform:</p>
          <ul className="list-disc list-outside pl-4 space-y-1">
            <li><strong className="text-black">Project data</strong> — project names, addresses, structure types, print parameters, layer counts, and print speed settings you enter during setup.</li>
            <li><strong className="text-black">Slicer inputs and outputs</strong> — uploaded 3D model files (STL, OBJ, IFC, DXF), printer settings, weather parameters, and the resulting slice data and G-code.</li>
            <li><strong className="text-black">Bead analysis results</strong> — structured outputs from live monitoring AI analysis, including defect type, severity, bead count, confidence score, and timestamp. Camera frames themselves are not stored.</li>
            <li><strong className="text-black">Usage preferences</strong> — settings stored in your browser's local storage, including consent flags and display preferences.</li>
          </ul>
          <p>We do not collect your name, email address, or any other personally identifiable information unless you provide it voluntarily through project documentation.</p>
        </Section>

        <Section title="2. How We Store Data">
          <p>AutoBuild AI stores project and slicer data in <strong className="text-black">Supabase</strong>, a cloud database platform. Data is stored in a hosted PostgreSQL database. Supabase is subject to its own security and compliance certifications; see supabase.com/privacy for details.</p>
          <p>Browser preferences and consent flags are stored in your browser's <strong className="text-black">localStorage</strong> on your device only. This data does not leave your device unless you explicitly sync or share it.</p>
          <p>Camera frames captured during live monitoring are processed in memory only and are never written to disk or transmitted to any storage system unless you explicitly enable data training collection (see Section 4).</p>
        </Section>

        <Section title="3. Third-Party Services">
          <p>AutoBuild AI uses the following third-party services to deliver its features:</p>
          <div className="space-y-3 mt-2">
            {[
              {
                name: 'Anthropic (Claude API)',
                use:  'AI-powered bead quality analysis and defect detection.',
                note: 'Still images from your camera are transmitted to Anthropic for processing during live monitoring. Anthropic\'s data handling terms apply to this transmission.',
              },
              {
                name: 'Supabase',
                use:  'Project data storage, saved slices, and training frame storage.',
                note: 'Hosted PostgreSQL database. No EU or GDPR-specific personal data is stored without your explicit action.',
              },
              {
                name: 'OpenWeather API',
                use:  'Weather forecast data for print condition planning.',
                note: 'City search strings are transmitted to OpenWeather. No user identifiers are attached to these requests.',
              },
              {
                name: 'Vercel',
                use:  'Frontend hosting and edge network delivery.',
                note: 'Standard web server logs (IP, user-agent, request path) are retained by Vercel per their data retention policies.',
              },
              {
                name: 'Railway',
                use:  'Backend API hosting (slicer, optimizer, analysis endpoints).',
                note: 'Standard server logs are retained by Railway. Uploaded 3D model files are processed in memory and not persisted.',
              },
            ].map(({ name, use, note }) => (
              <div key={name} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
                <p className="text-xs font-bold text-black mb-0.5">{name}</p>
                <p className="text-xs text-black/60">{use}</p>
                <p className="text-[11px] text-black/35 mt-1">{note}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="4. AI Training Data">
          <p>AutoBuild AI may use anonymised print data to improve its AI models, <strong className="text-black">only if you have explicitly opted in</strong> via the Terms of Service acceptance flow or the Settings page.</p>
          <p>When opted in, the following structured data may be collected after a bead analysis event:</p>
          <ul className="list-disc list-outside pl-4 space-y-1">
            <li>Defect type and severity classification</li>
            <li>Bead count and angle deviation</li>
            <li>AI confidence score</li>
            <li>Camera angle and label</li>
            <li>Timestamp</li>
            <li>Project ID (anonymised, not linked to personal identity)</li>
          </ul>
          <p><strong className="text-black">Camera frames are never stored or used in training data.</strong> Only structured analysis outputs are eligible for collection.</p>
          <p>You can withdraw consent at any time via Settings → Data Training. Withdrawal is effective immediately for future events. It does not retroactively remove data already collected while opted in.</p>
        </Section>

        <Section title="5. Your Rights">
          <p>Depending on your jurisdiction, you may have rights including:</p>
          <ul className="list-disc list-outside pl-4 space-y-1">
            <li><strong className="text-black">Access</strong> — request a copy of data held about you.</li>
            <li><strong className="text-black">Deletion</strong> — request deletion of your project data.</li>
            <li><strong className="text-black">Correction</strong> — request correction of inaccurate data.</li>
            <li><strong className="text-black">Opt-out</strong> — withdraw AI training consent at any time via Settings.</li>
          </ul>
          <p>To exercise any of these rights, contact us using the details in Section 6 below.</p>
        </Section>

        <Section title="6. Contact">
          <p>For questions about this Privacy Policy, data deletion requests, or any other privacy-related enquiries, please reach out via the contact information provided in your project onboarding documentation.</p>
          <p>AutoBuild AI is committed to responding to privacy enquiries within a reasonable timeframe.</p>
        </Section>

        <div className="border-t border-gray-100 pt-6 mt-4">
          <p className="text-[11px] text-black/25 text-center">
            AutoBuild AI · {effective} · All rights reserved
          </p>
        </div>

      </div>
    </div>
  );
}
