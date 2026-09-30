/**
 * Results & transcripts, the registrar's view.
 *
 * Course results are computed from the lecturers' marks and the grading
 * scheme; publishing is what makes them part of a student's transcript.
 * The server refuses to publish a course whose assessments do not total
 * 100%, or where some students have no gradable mark, unless told to go
 * ahead anyway; this page shows why and asks.
 */
import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { gradebookService, type CourseResult, type Transcript } from '../services/gradebookService';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

interface Course { id: string; code: string; name: string }
interface Student { id: string; student_id: string; first_name: string; last_name: string }

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

const SchoolAdminResultsPage: React.FC = () => {
  const [tab, setTab] = useState<'results' | 'transcripts'>('results');
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Results &amp; transcripts</h1>
        <p className="text-sm text-secondary mt-1">Publish course results and read any student's transcript.</p>
      </header>
      <div className="flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === 'results'} className={tab === 'results' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('results')}>Course results</button>
        <button role="tab" aria-selected={tab === 'transcripts'} className={tab === 'transcripts' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setTab('transcripts')}>Transcripts</button>
      </div>
      {tab === 'results' ? <CourseResults /> : <Transcripts />}
    </div>
  );
};

const CourseResults: React.FC = () => {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [data, setData] = useState<{ scheme: { name: string; passMark: number }; results: CourseResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get('/auth/admin/school/courses')
      .then((r) => setCourses(r.data.courses))
      .catch((e) => setError(errorOf(e, 'Courses could not be loaded')));
  }, []);

  const load = async (id: string) => {
    setData(null);
    setError(null);
    if (!id) return;
    try {
      setData(await gradebookService.results(id));
    } catch (e: any) {
      setError(errorOf(e, 'Results could not be computed'));
    }
  };

  useEffect(() => { setNotice(null); void load(courseId); }, [courseId]);

  const publish = async (force = false) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await gradebookService.publish(courseId, force ? { force: true } : undefined);
      setNotice(r.message + (r.skipped ? ` (${r.skipped} without a gradable mark were left out)` : ''));
      await load(courseId);
    } catch (e: any) {
      const d = e?.response?.data;
      if (e?.response?.status === 409 && !force) {
        if (confirm(`${d?.error}.\n\nPublish anyway?`)) {
          setBusy(false);
          return publish(true);
        }
        setNotice(d?.error ?? 'Not published');
      } else {
        setNotice(errorOf(e, 'Results could not be published'));
      }
    } finally {
      setBusy(false);
    }
  };

  const withhold = async (r: CourseResult) => {
    if (!r.resultId || !confirm('Withhold this result? It leaves the student\'s transcript until published again.')) return;
    try {
      await gradebookService.withhold(r.resultId);
      await load(courseId);
    } catch (e: any) {
      setNotice(errorOf(e, 'The result could not be withheld'));
    }
  };

  if (courses === null && !error) return <LoadingState label="Loading courses…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-secondary">Course{' '}
          <select className="input-field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">Choose a course…</option>
            {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        {data && data.results.length > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish results'}
          </button>
        )}
      </div>
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
      {error ? (
        <ErrorState title="Something went wrong" description={error} onRetry={() => void load(courseId)} />
      ) : !courseId ? (
        <EmptyState title="Choose a course" description="Its computed results appear here." />
      ) : data === null ? (
        <LoadingState label="Computing results…" />
      ) : data.results.length === 0 ? (
        <EmptyState title="No results yet" description="No students on this course have marks." />
      ) : (
        <div className="card overflow-x-auto">
          <p className="text-xs text-muted mb-2">Grading scheme: {data.scheme.name} · pass mark {data.scheme.passMark}%</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">Student</th>
                <th className="py-2 pr-4 text-right">Score</th>
                <th className="py-2 pr-4">Grade</th>
                <th className="py-2 pr-4">Weight marked</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.studentId} className="border-b border-subtle">
                  <td className="py-2 pr-4">
                    {r.student ? `${r.student.first_name} ${r.student.last_name}` : 'Unknown student'}
                    <div className="text-xs text-muted">{r.student?.student_id}</div>
                  </td>
                  <td className="py-2 pr-4 text-right">{r.totalScore}%</td>
                  <td className="py-2 pr-4">{r.letter ?? <span className="text-muted">—</span>}</td>
                  <td className="py-2 pr-4 text-secondary">{r.weightGraded}% of {r.weightDeclared}%{r.pending ? ` · ${r.pending} pending` : ''}</td>
                  <td className="py-2 pr-4"><span className={r.status === 'published' ? 'badge badge-brand' : r.status === 'withheld' ? 'badge badge-warning' : 'badge badge-neutral'}>{r.status}</span></td>
                  <td className="py-2 text-right">
                    {r.status === 'published' && r.resultId && (
                      <button className="btn btn-ghost" onClick={() => void withhold(r)}>Withhold</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Transcripts: React.FC = () => {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/auth/admin/school/students', { params: { fields: 'summary' } })
      .then((r) => setStudents(r.data.students))
      .catch((e) => setError(errorOf(e, 'Students could not be loaded')));
  }, []);

  useEffect(() => {
    setTranscript(null);
    setError(null);
    if (!studentId) return;
    gradebookService.transcript(studentId)
      .then(setTranscript)
      .catch((e) => setError(errorOf(e, 'The transcript could not be loaded')));
  }, [studentId]);

  const q = search.trim().toLowerCase();
  const shown = (students ?? []).filter((s) => !q
    || `${s.first_name} ${s.last_name} ${s.student_id}`.toLowerCase().includes(q)).slice(0, 200);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-secondary">Find a student{' '}
          <input className="input-field" value={search} placeholder="Name or student number" onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="text-sm text-secondary">Student{' '}
          <select className="input-field" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Choose…</option>
            {shown.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.student_id})</option>)}
          </select>
        </label>
      </div>
      {error ? (
        <ErrorState title="Something went wrong" description={error} />
      ) : students === null ? (
        <LoadingState label="Loading students…" />
      ) : !studentId ? (
        <EmptyState title="Choose a student" description="Their published results and grade point average appear here." />
      ) : transcript === null ? (
        <LoadingState label="Loading transcript…" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card">
              <div className="text-xs uppercase text-muted">{transcript.creditWeighted ? 'CGPA' : 'Average grade point'}</div>
              <div className="text-2xl font-semibold text-primary mt-1">{transcript.cgpa ?? '—'}</div>
            </div>
            <div className="card">
              <div className="text-xs uppercase text-muted">Credits earned</div>
              <div className="text-2xl font-semibold text-primary mt-1">{transcript.creditsEarned} / {transcript.creditsAttempted}</div>
            </div>
            <div className="card">
              <div className="text-xs uppercase text-muted">Programme</div>
              <div className="text-sm text-primary mt-1">{transcript.programme ? `${transcript.programme.name} · year ${transcript.programme.current_study_year}` : 'Not enrolled on a programme'}</div>
            </div>
          </div>
          {transcript.entries.length === 0 ? (
            <EmptyState title="No published results" description="Nothing has been published for this student yet." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-subtle">
                    <th className="py-2 pr-4">Year</th>
                    <th className="py-2 pr-4">Course</th>
                    <th className="py-2 pr-4">Term</th>
                    <th className="py-2 pr-4 text-right">Score</th>
                    <th className="py-2 pr-4">Grade</th>
                    <th className="py-2 text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {transcript.entries.map((e) => (
                    <tr key={`${e.course_code}-${e.semester_name ?? ''}-${e.academic_year ?? ''}`} className="border-b border-subtle">
                      <td className="py-2 pr-4 text-secondary">{e.academic_year ?? '—'}</td>
                      <td className="py-2 pr-4">{e.course_name}<div className="text-xs text-muted">{e.course_code}</div></td>
                      <td className="py-2 pr-4 text-secondary">{e.semester_name ?? '—'}</td>
                      <td className="py-2 pr-4 text-right">{e.total_score}%</td>
                      <td className="py-2 pr-4"><span className={e.is_pass ? 'badge badge-brand' : 'badge badge-danger'}>{e.letter}</span></td>
                      <td className="py-2 text-right">{e.credits || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SchoolAdminResultsPage;
