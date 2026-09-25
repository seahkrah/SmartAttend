import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, BookOpen, GraduationCap, X } from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, NoResults } from '../components/ErrorDisplay';
import {
  academicsService,
  type Programme,
  type CurriculumEntry,
} from '../services/academicsService';
import adminService, { type Course } from '../services/adminService';

/**
 * Programmes and their curriculum.
 *
 * A programme is what a student's courses add up to — the degree, its
 * duration and its credit requirement — and the curriculum is which courses
 * it requires in which year. Both were in the navigation as "planned" and
 * had nothing behind them.
 */

const REQUIREMENTS = ['core', 'elective', 'optional'] as const;

const SchoolAdminProgrammesPage: React.FC = () => {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Programme | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [form, setForm] = useState({
    code: '', name: '', award: '', level: '',
    durationYears: '4', creditsRequired: '', description: '',
  });

  const [entryForm, setEntryForm] = useState({
    courseId: '', studyYear: '1', requirement: 'core', credits: '',
  });

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const [list, courseList] = await Promise.all([
        academicsService.listProgrammes(),
        // The curriculum picker needs the catalogue; a failure there should
        // not stop the programme list rendering.
        adminService.listCourses(200, 0).catch(() => ({ courses: [] as Course[], total: 0 })),
      ]);
      setProgrammes(list);
      setCourses(courseList.courses);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load programmes', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const openProgramme = async (programme: Programme) => {
    try {
      setDetailLoading(true);
      setSelected(programme);
      const detail = await academicsService.getProgramme(programme.id);
      setSelected(detail.programme);
      setCurriculum(detail.curriculum);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not open programme', message: getErrorMessage(error) });
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitProgramme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      addToast({ type: 'error', title: 'Missing details', message: 'A programme needs a code and a name.' });
      return;
    }
    try {
      setSaving(true);
      const created = await academicsService.createProgramme({
        code: form.code.trim(),
        name: form.name.trim(),
        award: form.award.trim() || undefined,
        level: form.level.trim() || undefined,
        durationYears: Number(form.durationYears) || 4,
        creditsRequired: form.creditsRequired ? Number(form.creditsRequired) : undefined,
        description: form.description.trim() || undefined,
      });
      setProgrammes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false);
      setForm({ code: '', name: '', award: '', level: '', durationYears: '4', creditsRequired: '', description: '' });
      addToast({ type: 'success', title: 'Programme created', message: `${created.code} — ${created.name}` });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create programme', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const removeProgramme = async (programme: Programme) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete programme',
      message: `Delete ${programme.code} — ${programme.name}? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await academicsService.deleteProgramme(programme.id);
      setProgrammes((prev) => prev.filter((p) => p.id !== programme.id));
      if (selected?.id === programme.id) setSelected(null);
      addToast({ type: 'success', title: 'Programme deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete', message: getErrorMessage(error) });
    }
  };

  const addCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !entryForm.courseId) return;
    try {
      setSaving(true);
      const entry = await academicsService.addCourseToProgramme(selected.id, {
        courseId: entryForm.courseId,
        studyYear: Number(entryForm.studyYear) || 1,
        requirement: entryForm.requirement,
        credits: entryForm.credits ? Number(entryForm.credits) : undefined,
      });
      setCurriculum((prev) => [...prev, entry]);
      setEntryForm({ courseId: '', studyYear: entryForm.studyYear, requirement: 'core', credits: '' });
      addToast({ type: 'success', title: 'Course added to curriculum' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not add course', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: CurriculumEntry) => {
    if (!selected) return;
    try {
      await academicsService.removeCourseFromProgramme(selected.id, entry.id);
      setCurriculum((prev) => prev.filter((c) => c.id !== entry.id));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not remove course', message: getErrorMessage(error) });
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return programmes;
    return programmes.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.code.toLowerCase().includes(term) ||
        (p.award ?? '').toLowerCase().includes(term)
    );
  }, [programmes, search]);

  const byYear = useMemo(() => {
    const groups = new Map<number, CurriculumEntry[]>();
    for (const entry of curriculum) {
      const list = groups.get(entry.study_year) ?? [];
      list.push(entry);
      groups.set(entry.study_year, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [curriculum]);

  if (loading) {
    return (
      <>
        <LoadingOverlay message="Loading programmes…" />
      </>
    );
  }

  return (
    <>
      <ConfirmDialog />

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Programmes &amp; Curriculum</h1>
          <p className="text-sm text-slate-400 mt-1">
            What a student reads, and which courses it requires in each year.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" />
          New programme
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search programmes"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {programmes.length === 0 ? (
            <EmptyState
              icon={<GraduationCap className="h-8 w-8" />}
              title="No programmes yet"
              message="Create a programme to describe what your students are reading."
            />
          ) : filtered.length === 0 ? (
            <NoResults searchTerm={search} onClearSearch={() => setSearch('')} />
          ) : (
            <ul className="space-y-2">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => void openProgramme(p)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      selected?.id === p.id
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">{p.code}</span>
                      <span className="text-xs text-slate-500">{p.duration_years} yr</span>
                    </div>
                    <div className="text-sm text-slate-300">{p.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {p.course_count ?? 0} course(s) · {p.student_count ?? 0} student(s)
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {!selected ? (
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title="Select a programme"
              message="Choose a programme on the left to see and edit its curriculum."
            />
          ) : detailLoading ? (
            <LoadingOverlay message="Loading curriculum…" />
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">{selected.name}</h2>
                    <p className="text-sm text-slate-400">
                      {selected.code}
                      {selected.award ? ` · ${selected.award}` : ''}
                      {selected.credits_required ? ` · ${selected.credits_required} credits` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => void removeProgramme(selected)}
                    className="rounded-lg border border-danger-700/60 px-3 py-1.5 text-sm text-danger-300 hover:bg-danger-900/30"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <form
                onSubmit={addCourse}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Add a course
                </h3>
                <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px_100px_auto]">
                  <select
                    value={entryForm.courseId}
                    onChange={(e) => setEntryForm({ ...entryForm, courseId: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Select a course…</option>
                    {courses
                      .filter((c) => !curriculum.some((e) => e.course_id === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={entryForm.studyYear}
                    onChange={(e) => setEntryForm({ ...entryForm, studyYear: e.target.value })}
                    placeholder="Year"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
                  />
                  <select
                    value={entryForm.requirement}
                    onChange={(e) => setEntryForm({ ...entryForm, requirement: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
                  >
                    {REQUIREMENTS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={entryForm.credits}
                    onChange={(e) => setEntryForm({ ...entryForm, credits: e.target.value })}
                    placeholder="Credits"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
                  />
                  <button
                    type="submit"
                    disabled={!entryForm.courseId || saving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </form>

              {curriculum.length === 0 ? (
                <EmptyState
                  icon={<BookOpen className="h-8 w-8" />}
                  title="No courses in this curriculum"
                  message="Add the courses this programme requires, and the year each one falls in."
                />
              ) : (
                byYear.map(([year, entries]) => (
                  <div key={year} className="rounded-xl border border-slate-800 bg-slate-900/60">
                    <div className="border-b border-slate-800 px-5 py-3 text-sm font-semibold text-slate-300">
                      Year {year}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {entries.length} course(s)
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-800">
                      {entries.map((entry) => (
                        <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div>
                            <div className="text-sm text-slate-200">
                              {entry.course_code} — {entry.course_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {entry.requirement}
                              {entry.credits ?? entry.course_credits
                                ? ` · ${entry.credits ?? entry.course_credits} credits`
                                : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => void removeEntry(entry)}
                            aria-label={`Remove ${entry.course_code}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-danger-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submitProgramme}
            className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">New programme</h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Close"
                className="rounded p-1 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-300">
                Code
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
              <label className="text-sm text-slate-300">
                Award
                <input
                  value={form.award}
                  onChange={(e) => setForm({ ...form, award: e.target.value })}
                  placeholder="BSc (Hons)"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
              <label className="sm:col-span-2 text-sm text-slate-300">
                Name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
              <label className="text-sm text-slate-300">
                Duration (years)
                <input
                  type="number"
                  min={1}
                  max={10}
                  step="0.5"
                  value={form.durationYears}
                  onChange={(e) => setForm({ ...form, durationYears: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
              <label className="text-sm text-slate-300">
                Credits required
                <input
                  type="number"
                  min={1}
                  value={form.creditsRequired}
                  onChange={(e) => setForm({ ...form, creditsRequired: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200"
                />
              </label>
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
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create programme'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

export default SchoolAdminProgrammesPage;
