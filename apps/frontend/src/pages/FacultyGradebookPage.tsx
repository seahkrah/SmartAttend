import React, { useEffect, useState } from 'react';
import { ClipboardList, Plus, Save, Trash2, Award, AlertTriangle } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import facultyService, { type Course } from '../services/facultyService';
import {
  gradebookService,
  type Assessment,
  type MarkRow,
  type CourseResult,
  type ScoreStatus,
} from '../services/gradebookService';

/**
 * The lecturer's gradebook: assessments on a course, the mark sheet for each,
 * and the running result.
 *
 * Two things the interface has to be honest about, because the API is.
 *
 * Assessment weights are a contract with the class. The header shows the
 * running total and says plainly when it is not 100%, because a grade
 * computed over part of a course is not a final grade.
 *
 * An absent student scored zero; an unmarked student has no score yet. The
 * mark sheet keeps those distinct rather than leaving a blank that could mean
 * either.
 */

const KINDS: Assessment['kind'][] = [
  'assignment', 'quiz', 'test', 'midterm', 'exam', 'project', 'practical', 'participation',
];

const STATUSES: ScoreStatus[] = ['graded', 'pending', 'absent', 'excused'];

const FacultyGradebookPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string>('');
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [weightTotal, setWeightTotal] = useState(0);
  const [weightComplete, setWeightComplete] = useState(false);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [form, setForm] = useState({
    title: '', kind: 'assignment' as Assessment['kind'], maxScore: '100', weight: '', dueDate: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        const list = await facultyService.getCourses();
        setCourses(list);
        if (list.length > 0) setCourseId(list[0].id);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!courseId) return;
    void loadCourse(courseId);
  }, [courseId]);

  const loadCourse = async (id: string) => {
    try {
      setBusy(true);
      setError(null);
      setActiveAssessment(null);
      setMarks([]);
      const [list, computed] = await Promise.all([
        gradebookService.listAssessments(id),
        gradebookService.results(id).catch(() => null),
      ]);
      setAssessments(list.assessments);
      setWeightTotal(list.weightTotal);
      setWeightComplete(list.weightComplete);
      setResults(computed?.results ?? []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openMarkSheet = async (assessment: Assessment) => {
    try {
      setBusy(true);
      const sheet = await gradebookService.markSheet(assessment.id);
      setActiveAssessment(sheet.assessment);
      setMarks(sheet.scores);
    } catch (e) {
      addToast({ type: 'error', title: 'Could not open the mark sheet', message: getErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const createAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    const weight = Number(form.weight);
    if (!form.title.trim() || !Number.isFinite(weight) || weight <= 0) {
      addToast({ type: 'error', title: 'Missing details', message: 'An assessment needs a title and a weight above zero.' });
      return;
    }
    try {
      setBusy(true);
      await gradebookService.createAssessment(courseId, {
        title: form.title.trim(),
        kind: form.kind,
        maxScore: Number(form.maxScore) || 100,
        weight,
        dueDate: form.dueDate || undefined,
      });
      setShowForm(false);
      setForm({ title: '', kind: 'assignment', maxScore: '100', weight: '', dueDate: '' });
      await loadCourse(courseId);
      addToast({ type: 'success', title: 'Assessment created' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not create assessment', message: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const removeAssessment = async (assessment: Assessment) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete assessment',
      message: `Delete “${assessment.title}”? Any marks recorded against it go too.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await gradebookService.deleteAssessment(assessment.id);
      if (activeAssessment?.id === assessment.id) setActiveAssessment(null);
      await loadCourse(courseId);
      addToast({ type: 'success', title: 'Assessment deleted' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not delete', message: getErrorMessage(err) });
    }
  };

  const setMark = (studentId: string, patch: Partial<MarkRow>) => {
    setMarks((prev) => prev.map((m) => (m.student_id === studentId ? { ...m, ...patch } : m)));
  };

  const saveMarks = async () => {
    if (!activeAssessment) return;
    try {
      setBusy(true);
      // Rows with no score and no status were never touched, so they are not
      // sent: submitting them as pending would overwrite a colleague's mark.
      const payload = marks
        .filter((m) => m.score !== null || (m.status && m.status !== 'pending'))
        .map((m) => ({
          studentId: m.student_id,
          score: m.status === 'absent' || m.status === 'excused' ? null : m.score,
          status: m.status ?? 'graded',
          feedback: m.feedback ?? undefined,
        }));

      if (payload.length === 0) {
        addToast({ type: 'info', title: 'Nothing to save', message: 'Enter at least one mark first.' });
        return;
      }

      const { written } = await gradebookService.saveMarks(activeAssessment.id, payload);
      addToast({ type: 'success', title: 'Marks saved', message: `${written} mark(s) recorded` });
      await loadCourse(courseId);
      await openMarkSheet(activeAssessment);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not save marks', message: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading your courses…" />;

  if (courses.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No courses assigned"
          message="You are not teaching any courses yet, so there is nothing to grade."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <ConfirmDialog />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Gradebook</h1>
          <p className="text-sm text-slate-400 mt-1">
            Assessments, marks and the running result for your courses.
          </p>
        </div>
        <label className="text-sm text-slate-300">
          Course
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorAlert title="Could not load the gradebook" message={error} onDismiss={() => setError(null)} />}

      <div className="rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Assessments
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                weightComplete
                  ? 'bg-success-500/15 text-success-300'
                  : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {weightTotal}% of 100%
            </span>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            <Plus className="h-4 w-4" />
            Add assessment
          </button>
        </div>

        {!weightComplete && assessments.length > 0 && (
          <div className="flex items-start gap-2 border-b border-slate-800 bg-amber-500/5 px-5 py-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              These assessments carry {weightTotal}% of the course. Results computed now are
              provisional — the registrar cannot publish them as final until the weights total 100%.
            </span>
          </div>
        )}

        {assessments.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" />}
              title="No assessments yet"
              message="Add the pieces this course is assessed on, and what each is worth."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {assessments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <button
                  onClick={() => void openMarkSheet(a)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium text-slate-100">{a.title}</div>
                  <div className="text-xs text-slate-500">
                    {a.kind} · out of {a.max_score} · {a.weight}% of the course
                    {a.graded_count !== undefined ? ` · ${a.graded_count} marked` : ''}
                  </div>
                </button>
                <button
                  onClick={() => void removeAssessment(a)}
                  aria-label={`Delete ${a.title}`}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-danger-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeAssessment && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">{activeAssessment.title}</h2>
              <p className="text-xs text-slate-500">
                Marks out of {activeAssessment.max_score}
              </p>
            </div>
            <button
              onClick={() => void saveMarks()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save marks
            </button>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="px-5 py-2">Student</th>
                <th className="px-5 py-2 w-32">Score</th>
                <th className="px-5 py-2 w-40">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {marks.map((m) => (
                <tr key={m.student_id}>
                  <td className="px-5 py-2">
                    <div className="text-slate-200">
                      {m.first_name} {m.last_name}
                    </div>
                    <div className="text-xs text-slate-500">{m.student_number}</div>
                  </td>
                  <td className="px-5 py-2">
                    <input
                      type="number"
                      min={0}
                      max={activeAssessment.max_score}
                      value={m.score ?? ''}
                      disabled={m.status === 'absent' || m.status === 'excused'}
                      onChange={(e) =>
                        setMark(m.student_id, {
                          score: e.target.value === '' ? null : Number(e.target.value),
                          status: e.target.value === '' ? m.status : 'graded',
                        })
                      }
                      aria-label={`Score for ${m.first_name} ${m.last_name}`}
                      className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-5 py-2">
                    <select
                      value={m.status ?? 'pending'}
                      onChange={(e) => setMark(m.student_id, { status: e.target.value as ScoreStatus })}
                      aria-label={`Status for ${m.first_name} ${m.last_name}`}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="border-b border-slate-800 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
              <Award className="h-4 w-4" />
              Running results
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="px-5 py-2">Student</th>
                <th className="px-5 py-2">Total</th>
                <th className="px-5 py-2">Grade</th>
                <th className="px-5 py-2">Graded</th>
                <th className="px-5 py-2">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {results.map((r) => (
                <tr key={r.studentId}>
                  <td className="px-5 py-2 text-slate-200">
                    {r.student ? `${r.student.first_name} ${r.student.last_name}` : r.studentId}
                  </td>
                  <td className="px-5 py-2 text-slate-300">{r.totalScore}%</td>
                  <td className="px-5 py-2">
                    <span className={r.isPass ? 'text-success-300' : 'text-danger-300'}>
                      {r.letter ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-slate-400">
                    {r.weightGraded}% of {r.weightDeclared}%
                    {r.pending > 0 ? ` · ${r.pending} pending` : ''}
                  </td>
                  <td className="px-5 py-2 text-slate-400">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-800 px-5 py-3 text-xs text-slate-500">
            Percentages are over the assessments marked so far. Only a registrar can publish
            results, and only once the weights total 100%.
          </p>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={createAssessment}
            className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-100">New assessment</h2>
            <div className="grid gap-3">
              <label className="text-sm text-slate-300">
                Title
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm text-slate-300">
                  Kind
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as Assessment['kind'] })}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Out of
                  <input
                    type="number"
                    min={1}
                    value={form.maxScore}
                    onChange={(e) => setForm({ ...form, maxScore: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                  />
                </label>
                <label className="text-sm text-slate-300">
                  Weight %
                  <input
                    type="number"
                    min={1}
                    max={100 - weightTotal}
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500">
                {100 - weightTotal}% of this course is still unallocated.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default FacultyGradebookPage;
