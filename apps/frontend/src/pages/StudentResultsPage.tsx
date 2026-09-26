import React, { useEffect, useState } from 'react';
import { Award, GraduationCap, Info } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import { useAuthStore } from '../store/authStore';
import { gradebookService, type Transcript } from '../services/gradebookService';

/**
 * A student's own results and transcript.
 *
 * Only published results appear — the API's transcript view excludes
 * provisional and withheld ones, so a student never sees a grade the school
 * has not stood behind.
 *
 * The GPA says whether it is credit-weighted. A school that has not assigned
 * credit values gets a plain mean rather than nothing, and the page says
 * which it is instead of implying a weighting that was never set.
 */

const StudentResultsPage: React.FC = () => {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToastStore();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    void (async () => {
      try {
        // The transcript is keyed on the student record, not the user. This
        // used to read an id off /attendance/profile, which returns the USER
        // id — so every request asked for a student that does not exist and
        // the page had never once loaded. The API resolves the record from
        // the signed-in identity instead.
        setTranscript(await gradebookService.myTranscript());
      } catch (e) {
        const message = getErrorMessage(e);
        setError(message);
        addToast({ type: 'error', title: 'Could not load your results', message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingOverlay message="Loading your results…" />;

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert title="Results unavailable" message={error} />
      </div>
    );
  }

  if (!transcript) return null;

  const byYear = new Map<string, typeof transcript.entries>();
  for (const entry of transcript.entries) {
    const key = entry.academic_year ?? 'Unassigned';
    byYear.set(key, [...(byYear.get(key) ?? []), entry]);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Results &amp; Transcript</h1>
        <p className="mt-1 text-sm text-secondary">
          {user?.fullName ? `${user.fullName} · ` : ''}
          {transcript.student.studentNumber}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-subtle bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted">
            {transcript.creditWeighted ? 'CGPA' : 'Average grade point'}
          </div>
          <div className="mt-2 text-3xl font-bold text-primary">
            {transcript.cgpa ?? '—'}
          </div>
          {!transcript.creditWeighted && transcript.cgpa !== null && (
            <div className="mt-1 flex items-start gap-1.5 text-xs text-muted">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>Not credit-weighted — your school has not set course credits.</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-subtle bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted">Credits earned</div>
          <div className="mt-2 text-3xl font-bold text-primary">
            {transcript.creditsEarned}
            <span className="ml-1 text-base font-normal text-muted">
              / {transcript.creditsAttempted}
            </span>
          </div>
          {transcript.programme?.credits_required && (
            <div className="mt-1 text-xs text-muted">
              {transcript.programme.credits_required} required to graduate
            </div>
          )}
        </div>

        <div className="rounded-xl border border-subtle bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted">Programme</div>
          {transcript.programme ? (
            <>
              <div className="mt-2 text-base font-semibold text-primary">
                {transcript.programme.name}
              </div>
              <div className="mt-1 text-xs text-muted">
                Year {transcript.programme.current_study_year}
                {transcript.programme.award ? ` · ${transcript.programme.award}` : ''}
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-muted">Not enrolled on a programme</div>
          )}
        </div>
      </div>

      {transcript.entries.length === 0 ? (
        <EmptyState
          icon={<Award className="h-8 w-8" />}
          title="No published results yet"
          message="Results appear here once your school publishes them. Marks still being entered are not shown."
        />
      ) : (
        [...byYear.entries()].map(([year, entries]) => (
          <div key={year} className="rounded-xl border border-subtle bg-card">
            <div className="flex items-center gap-2 border-b border-subtle px-5 py-3">
              <GraduationCap className="h-4 w-4 text-muted" />
              <h2 className="text-sm font-semibold text-secondary">{year}</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr className="border-b border-subtle">
                  <th className="px-5 py-2">Course</th>
                  <th className="px-5 py-2">Term</th>
                  <th className="px-5 py-2">Score</th>
                  <th className="px-5 py-2">Grade</th>
                  <th className="px-5 py-2">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {entries.map((entry) => (
                  <tr key={`${entry.course_code}-${entry.semester_name ?? ''}`}>
                    <td className="px-5 py-2">
                      <div className="text-primary">{entry.course_name}</div>
                      <div className="text-xs text-muted">{entry.course_code}</div>
                    </td>
                    <td className="px-5 py-2 text-secondary">{entry.semester_name ?? '—'}</td>
                    <td className="px-5 py-2 text-secondary">{entry.total_score}%</td>
                    <td className="px-5 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          entry.is_pass
                            ? 'bg-success-500/15 text-success-700 dark:text-success-300'
                            : 'bg-danger-500/15 text-danger-700 dark:text-danger-400'
                        }`}
                      >
                        {entry.letter}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-secondary">{entry.credits || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
};

export default StudentResultsPage;
