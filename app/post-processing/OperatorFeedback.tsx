'use client';

import { useState, type FormEvent } from 'react';
import { setRunFeedback, type Evidence } from '@/lib/post-print-evidence.mjs';
import { actionClass, fieldClass, panelClass } from '@/lib/post-print-workspace';

export default function OperatorFeedback({ evidence, save }: { evidence: Evidence; save: (transform: (e: Evidence) => Evidence) => void }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      save(e => setRunFeedback(e, { rating: Number(form.get('rating')), helpful: form.get('helpful') === 'yes', notes: String(form.get('notes') ?? ''), recordedAt: new Date().toISOString() }));
      setMessage({ text: 'Feedback saved in this browser.', error: false });
    } catch {
      setMessage({ text: 'Feedback could not be saved in this browser.', error: true });
    }
  }
  return <section className={`${panelClass} space-y-3`} aria-labelledby="operator-feedback">
    <h2 id="operator-feedback" className="text-lg font-semibold">Operator feedback</h2>
    <form onSubmit={submit} onChange={() => setMessage(null)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Overall print rating<select className={fieldClass} name="rating" required defaultValue={evidence.feedback?.rating ?? ''}>
          <option value="" disabled>Choose 1 to 5</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}
        </select></label>
        <label className="space-y-1 text-sm">Did the tools help?<select className={fieldClass} name="helpful" required defaultValue={evidence.feedback ? (evidence.feedback.helpful ? 'yes' : 'no') : ''}>
          <option value="" disabled>Choose yes or no</option><option value="yes">Yes</option><option value="no">No</option>
        </select></label>
      </div>
      <label className="block space-y-1 text-sm">Notes (optional)<textarea className={fieldClass} name="notes" maxLength={1000} rows={3} defaultValue={evidence.feedback?.notes ?? ''} /></label>
      <button className={actionClass} type="submit">Save feedback</button>
      {message && <p role={message.error ? 'alert' : 'status'} className="text-sm">{message.text}</p>}
    </form>
  </section>;
}