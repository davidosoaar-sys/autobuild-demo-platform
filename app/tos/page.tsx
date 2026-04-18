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

export default function TosPage() {
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
            <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight mb-2">Terms of Service</h1>
          <p className="text-xs text-black/35">AutoBuild AI · Effective {effective}</p>
        </div>

        <div className="bg-black text-white rounded-2xl px-5 py-4 mb-8 text-xs leading-relaxed">
          Please read these terms carefully before using AutoBuild AI. By accessing or using the platform you agree to be bound by these terms.
        </div>

        <Section title="1. About AutoBuild AI">
          <p>AutoBuild AI is a 3D concrete printing (3DCP) platform that provides AI-powered defect detection, path optimisation, and live monitoring tools. The platform is developed and operated under the AutoBuild AI name.</p>
          <p>AutoBuild AI uses artificial intelligence models, including Claude by Anthropic, to analyse camera feeds and uploaded images for quality assessment purposes.</p>
        </Section>

        <Section title="2. AI Analysis Limitations">
          <p>AutoBuild AI uses machine learning and computer vision to analyse concrete bead quality and detect potential defects. These analyses are provided as decision-support tools only.</p>
          <p><strong className="text-black">AI outputs are not a substitute for qualified engineering judgement.</strong> AutoBuild AI does not guarantee the accuracy, completeness, or fitness for purpose of any AI-generated analysis, bead assessment, defect classification, or path optimisation result.</p>
          <p>You are solely responsible for all decisions made during the printing process, including whether to pause, stop, or continue a print based on platform outputs. AutoBuild AI accepts no liability for structural failures, material waste, or safety incidents arising from reliance on platform outputs.</p>
        </Section>

        <Section title="3. Data and Privacy">
          <p>AutoBuild AI processes camera frames, uploaded images, and project data to deliver its services. Image data sent for AI analysis is transmitted to Anthropic's API under Anthropic's data processing terms.</p>
          <p>AutoBuild AI does not permanently store camera frames or uploaded layer images beyond the duration of an active session. Project metadata (print parameters, sensor readings, report data) may be stored to support your session and report generation.</p>
          <p>You should not upload or transmit images or data that contain personally identifiable information, confidential proprietary information, or data subject to regulatory restrictions.</p>
        </Section>

        <Section title="4. Acceptable Use">
          <p>You agree to use AutoBuild AI only for lawful purposes related to 3D concrete printing operations and quality control. You must not attempt to reverse-engineer, scrape, or misuse the platform, its AI models, or its outputs.</p>
          <p>AutoBuild AI is not intended for use in safety-critical infrastructure where AI analysis errors could result in loss of life. Any use in structural applications must be validated by a qualified structural engineer.</p>
        </Section>

        <Section title="5. No Warranty">
          <p>AutoBuild AI is provided "as is" without warranties of any kind, express or implied. We do not warrant that the platform will be uninterrupted, error-free, or that defects will be corrected.</p>
          <p>We expressly disclaim all warranties relating to print quality outcomes, structural integrity assessments, and the reliability of AI-generated recommendations.</p>
        </Section>

        <Section title="6. Limitation of Liability">
          <p>To the maximum extent permitted by law, AutoBuild AI and its developers shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the platform, including but not limited to: print failures, material costs, structural defects, or business losses.</p>
        </Section>

        <Section title="7. Changes to These Terms">
          <p>We may update these Terms of Service from time to time. Continued use of AutoBuild AI after changes are posted constitutes acceptance of the revised terms. The effective date at the top of this page reflects the most recent revision.</p>
        </Section>

        <Section title="8. Contact">
          <p>For questions about these terms or the AutoBuild AI platform, please reach out via the contact information provided in your project onboarding documentation.</p>
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