/**
 * A grade school's classes for an academic year.
 *
 * Each grade is divided into classes (Grade 4A, Grade 4B), each with a class
 * teacher and, optionally, a capacity. Opening a class shows who is in it and
 * places more students; a student sits in one class a year, so placing a child
 * who is already in another class moves them.
 *
 * Classes belong to a year: next year's Grade 4A is a different set of
 * children. A school with no academic year yet creates one here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Plus, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import { academicsService, type AcademicYear } from '../services/academicsService';
import {
  gradeSchoolService, studentName, teacherName,
  type ClassStudent, type SchoolClass, type Teacher,
} from '../services/gradeSchoolService';
import { useAuthStore } from '../store/authStore';
import { useSchoolStructureStore } from '../store/schoolStructureStore';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

const errorOf = (e: any, fallback: string): string => e?.response?.data?.error ?? fallback;
const input = 'w-full px-3 py-2 bg-card border border-subtle rounded-lg text-primary outline-none focus:border-brand-500';

// ---------------------------------------------------------------------------
// A new academic year
// ---------------------------------------------------------------------------

const NewYearForm: React.FC<{ onDone: (y: AcademicYear) => void; onCancel?: () => void }> = ({ onDone, onCancel }) => {
  const thisYear = new Date().getFullYear();
  const [start, setStart] = useState(`${thisYear}-09-01`);
  const [end, setEnd] = useState(`${thisYear + 1}-07-31`);
  const [current, setCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A year is named for the calendar years it spans: 2026/2027.
  const name = start && end ? `${start.slice(0, 4)}/${end.slice(0, 4)}` : '';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await academicsService.createYear({ name, startDate: start, endDate: end, isCurrent: current }));
    } catch (err) {
      setError(errorOf(err, 'The academic year could not be created'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="card space-y-4 max-w-xl">
      <h2 className="font-semibold text-primary">New academic year {name && <span className="text-muted">· {name}</span>}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block text-secondary mb-1">Starts</span>
          <input type="date" className={input} value={start} required onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="block text-secondary mb-1">Ends</span>
          <input type="date" className={input} value={end} required onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary">
        <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
        This is the current year
      </label>
      {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create year'}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// One class: its details and who is in it
// ---------------------------------------------------------------------------

const ClassPanel: React.FC<{
  cls: SchoolClass;
  teachers: Teacher[];
  onChanged: () => void;
  onClose: () => void;
}> = ({ cls, teachers, onChanged, onClose }) => {
  const [students, setStudents] = useState<ClassStudent[] | null>(null);
  const [unplaced, setUnplaced] = useState<ClassStudent[]>([]);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ name: cls.name, teacher: cls.class_teacher_id ?? '', capacity: cls.capacity ? String(cls.capacity) : '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        gradeSchoolService.classStudents(cls.id),
        gradeSchoolService.unplacedStudents(cls.academic_year_id),
      ]);
      setStudents(s);
      setUnplaced(u);
    } catch (e) {
      setError(errorOf(e, 'The class list could not be loaded'));
    }
  }, [cls.id, cls.academic_year_id]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorOf(e, 'That could not be done'));
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    void act(() => gradeSchoolService.updateClass(cls.id, {
      name: form.name.trim(),
      classTeacherId: form.teacher || null,
      capacity: form.capacity ? Number(form.capacity) : null,
    }));
  };

  const place = () => act(async () => {
    await gradeSchoolService.placeStudents(cls.id, [...chosen]);
    setChosen(new Set());
    setPicking(false);
  });

  const shown = unplaced.filter((s) =>
    `${studentName(s)} ${s.student_id}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" role="dialog" aria-label={cls.display_name}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-page border-l border-subtle p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-primary">{cls.display_name}</h2>
            <p className="text-sm text-muted">
              {students?.length ?? cls.student_count} student(s){cls.capacity ? ` of ${cls.capacity}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}

        <form onSubmit={saveDetails} className="card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block text-secondary mb-1">Class name</span>
              <input className={input} value={form.name} required maxLength={30}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="block text-secondary mb-1">Capacity</span>
              <input className={input} type="number" min={1} value={form.capacity} placeholder="No limit"
                onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="block text-secondary mb-1">Class teacher</span>
            <select className={input} value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })}>
              <option value="">No class teacher yet</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{teacherName(t)}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>Save</button>
            <button type="button" className="btn btn-ghost text-danger-600" disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove ${cls.display_name}? Only an empty class can be removed.`)) {
                  void act(async () => { await gradeSchoolService.deleteClass(cls.id); onClose(); });
                }
              }}>
              <Trash2 className="w-4 h-4 inline mr-1" />Remove class
            </button>
          </div>
        </form>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-primary">Students</h3>
            <button className="btn btn-secondary text-sm" onClick={() => setPicking((v) => !v)}>
              <UserPlus className="w-4 h-4 inline mr-1" />{picking ? 'Done' : 'Add students'}
            </button>
          </div>

          {picking && (
            <div className="card space-y-3">
              <p className="text-sm text-secondary">Students not yet in a class this year.</p>
              <input className={input} placeholder="Search by name or number" value={filter}
                onChange={(e) => setFilter(e.target.value)} />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {shown.length === 0 && <p className="text-sm text-muted">Nobody to add.</p>}
                {shown.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-1">
                    <input type="checkbox" checked={chosen.has(s.id)} onChange={() => {
                      const next = new Set(chosen);
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                      setChosen(next);
                    }} />
                    <span className="text-primary">{studentName(s)}</span>
                    <span className="text-muted font-mono text-xs">{s.student_id}</span>
                  </label>
                ))}
              </div>
              <button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={() => void place()}>
                Add {chosen.size || ''} to {cls.display_name}
              </button>
            </div>
          )}

          {students === null ? (
            <LoadingState label="Loading the class list…" />
          ) : students.length === 0 ? (
            <EmptyState title="No students in this class yet" />
          ) : (
            <ul className="card divide-y divide-subtle p-0">
              {students.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    <span className="text-primary">{studentName(s)}</span>
                    <span className="text-muted font-mono text-xs ml-2">{s.student_id}</span>
                  </span>
                  <button className="btn btn-ghost text-xs" disabled={busy} title="Take out of this class"
                    onClick={() => void act(() => gradeSchoolService.removeStudent(cls.id, s.id))}>
                    <UserMinus className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const SchoolAdminClassesPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const { structure, forUser, load: loadStructure } = useSchoolStructureStore();
  const grades = (forUser === userId ? structure?.gradeLevels : null) ?? null;

  const [years, setYears] = useState<AcademicYear[] | null>(null);
  const [yearId, setYearId] = useState('');
  const [classes, setClasses] = useState<SchoolClass[] | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newYear, setNewYear] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // grade id
  const [addForm, setAddForm] = useState({ name: '', teacher: '', capacity: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [open, setOpen] = useState<SchoolClass | null>(null);

  useEffect(() => { if (userId) void loadStructure(userId, true); }, [userId, loadStructure]);

  const loadYears = useCallback(async (select?: string) => {
    try {
      const [ys, ts] = await Promise.all([academicsService.listYears(), gradeSchoolService.teachers()]);
      setYears(ys);
      setTeachers(ts);
      setYearId((cur) => select ?? (cur || ys.find((y) => y.is_current)?.id || ys[0]?.id || ''));
    } catch (e) {
      setError(errorOf(e, 'Academic years could not be loaded'));
    }
  }, []);

  const loadClasses = useCallback(async () => {
    if (!yearId) return;
    try {
      setClasses((await gradeSchoolService.listClasses({ yearId })).classes);
    } catch (e) {
      setError(errorOf(e, 'Classes could not be loaded'));
    }
  }, [yearId]);

  useEffect(() => { void loadYears(); }, [loadYears]);
  useEffect(() => { setClasses(null); void loadClasses(); }, [loadClasses]);

  const byGrade = useMemo(() => {
    const m = new Map<string, SchoolClass[]>();
    for (const c of classes ?? []) m.set(c.grade_level_id, [...(m.get(c.grade_level_id) ?? []), c]);
    return m;
  }, [classes]);

  const addClass = async (e: React.FormEvent, gradeId: string) => {
    e.preventDefault();
    setAddError(null);
    try {
      await gradeSchoolService.createClass({
        academicYearId: yearId, gradeLevelId: gradeId, name: addForm.name.trim(),
        classTeacherId: addForm.teacher || null, capacity: addForm.capacity ? Number(addForm.capacity) : null,
      });
      setAdding(null);
      setAddForm({ name: '', teacher: '', capacity: '' });
      await loadClasses();
    } catch (err) {
      setAddError(errorOf(err, 'The class could not be created'));
    }
  };

  // Suggest the next free letter for a grade: A, then B, then C.
  const nextName = (gradeId: string) => {
    const used = new Set((byGrade.get(gradeId) ?? []).map((c) => c.name.toUpperCase()));
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !used.has(l)) ?? '';
  };

  if (error) return <div className="p-6"><ErrorState title="Classes could not be loaded" description={error} onRetry={() => { setError(null); void loadYears(); }} /></div>;
  if (years === null || grades === null) return <div className="p-6"><LoadingState label="Loading classes…" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Classes</h1>
          <p className="text-sm text-secondary mt-1">Each grade's classes for the year, their class teachers and who is in them.</p>
        </div>
        <div className="flex items-center gap-2">
          {years.length > 0 && (
            <select className={`${input} w-auto`} value={yearId} onChange={(e) => setYearId(e.target.value)} aria-label="Academic year">
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>)}
            </select>
          )}
          <button className="btn btn-secondary whitespace-nowrap" onClick={() => setNewYear((v) => !v)}>
            <CalendarPlus className="w-4 h-4 inline mr-1" />New year
          </button>
        </div>
      </header>

      {(newYear || years.length === 0) && (
        <>
          {years.length === 0 && (
            <p className="text-sm text-secondary">Classes belong to an academic year. Create your school's first year to begin.</p>
          )}
          <NewYearForm
            onCancel={years.length ? () => setNewYear(false) : undefined}
            onDone={(y) => { setNewYear(false); void loadYears(y.id); }}
          />
        </>
      )}

      {years.length > 0 && grades.length === 0 && (
        <EmptyState title="Your school has no grades" description="Its levels are set by your JJELOTECH administrator." />
      )}

      {years.length > 0 && classes === null && <LoadingState label="Loading classes…" />}

      {years.length > 0 && classes !== null && (
        <div className="space-y-3">
          {grades.map((g) => {
            const list = byGrade.get(g.id) ?? [];
            return (
              <section key={g.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-primary w-28">{g.name}</h2>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {list.length === 0 && <span className="text-sm text-muted">No classes yet</span>}
                    {list.map((c) => (
                      <button key={c.id} onClick={() => setOpen(c)}
                        className="text-left px-3 py-2 rounded-lg bg-sunken hover:bg-raised border border-subtle">
                        <span className="block font-medium text-primary">{c.display_name}</span>
                        <span className="block text-xs text-muted">
                          {c.student_count}{c.capacity ? `/${c.capacity}` : ''} students · {c.class_teacher_name ?? 'no class teacher'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-ghost text-sm" onClick={() => {
                    setAdding(g.id); setAddError(null); setAddForm({ name: nextName(g.id), teacher: '', capacity: '' });
                  }}>
                    <Plus className="w-4 h-4 inline mr-1" />Add class
                  </button>
                </div>

                {adding === g.id && (
                  <form onSubmit={(e) => void addClass(e, g.id)} className="mt-4 grid gap-3 sm:grid-cols-4 items-end">
                    <label className="block text-sm">
                      <span className="block text-secondary mb-1">Class</span>
                      <input className={input} value={addForm.name} required maxLength={30}
                        onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="block text-secondary mb-1">Class teacher</span>
                      <select className={input} value={addForm.teacher} onChange={(e) => setAddForm({ ...addForm, teacher: e.target.value })}>
                        <option value="">Choose later</option>
                        {teachers.map((t) => <option key={t.id} value={t.id}>{teacherName(t)}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="block text-secondary mb-1">Capacity</span>
                      <input className={input} type="number" min={1} placeholder="No limit" value={addForm.capacity}
                        onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })} />
                    </label>
                    <div className="sm:col-span-4 flex items-center gap-2">
                      <button className="btn btn-primary">Create {g.name}{addForm.name}</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
                      {addError && <span role="alert" className="text-sm text-danger-600">{addError}</span>}
                    </div>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      )}

      {open && (
        <ClassPanel
          cls={open}
          teachers={teachers}
          onChanged={() => void loadClasses()}
          onClose={() => { setOpen(null); void loadClasses(); }}
        />
      )}
    </div>
  );
};

export default SchoolAdminClassesPage;
