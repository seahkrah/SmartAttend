/**
 * What a grade school teaches, and which grades take each subject.
 *
 * One row per subject, one column per grade: a tick means that grade takes
 * it. Report cards will list a class's subjects from here. A subject a grade
 * takes cannot be deleted, only marked inactive, so past records keep their
 * subject.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { gradeSchoolService, type Subject } from '../services/gradeSchoolService';
import { useAuthStore } from '../store/authStore';
import { useSchoolStructureStore } from '../store/schoolStructureStore';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

const errorOf = (e: any, fallback: string): string => e?.response?.data?.error ?? fallback;
const input = 'w-full px-3 py-2 bg-card border border-subtle rounded-lg text-primary outline-none focus:border-brand-500';

const SchoolAdminSubjectsPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const { structure, forUser, load: loadStructure } = useSchoolStructureStore();
  const grades = (forUser === userId ? structure?.gradeLevels : null) ?? null;

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (userId) void loadStructure(userId, true); }, [userId, loadStructure]);

  const load = useCallback(async () => {
    try {
      setSubjects(await gradeSchoolService.listSubjects());
    } catch (e) {
      setError(errorOf(e, 'Subjects could not be loaded'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice(errorOf(e, 'That could not be done'));
    } finally {
      setBusy(null);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void act('add', async () => {
      await gradeSchoolService.createSubject({ code: form.code.trim(), name: form.name.trim() });
      setForm({ code: '', name: '' });
    });
  };

  const toggle = (s: Subject, gradeId: string) => {
    const next = s.grade_level_ids.includes(gradeId)
      ? s.grade_level_ids.filter((g) => g !== gradeId)
      : [...s.grade_level_ids, gradeId];
    void act(`${s.id}:${gradeId}`, () => gradeSchoolService.setSubjectGrades(s.id, next));
  };

  const allGrades = (s: Subject) =>
    void act(`${s.id}:all`, () => gradeSchoolService.setSubjectGrades(
      s.id, s.grade_level_ids.length === grades!.length ? [] : grades!.map((g) => g.id)));

  if (error) return <div className="p-6"><ErrorState title="Subjects could not be loaded" description={error} onRetry={() => { setError(null); void load(); }} /></div>;
  if (subjects === null || grades === null) return <div className="p-6"><LoadingState label="Loading subjects…" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Subjects</h1>
        <p className="text-sm text-secondary mt-1">What your school teaches, and which grades take each subject.</p>
      </header>

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-[10rem_1fr_auto] items-end">
        <label className="block text-sm">
          <span className="block text-secondary mb-1">Code</span>
          <input className={`${input} font-mono`} value={form.code} required maxLength={20} placeholder="MATH"
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        </label>
        <label className="block text-sm">
          <span className="block text-secondary mb-1">Subject</span>
          <input className={input} value={form.name} required maxLength={100} placeholder="Mathematics"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <button className="btn btn-primary" disabled={busy === 'add'}><Plus className="w-4 h-4 inline mr-1" />Add subject</button>
      </form>

      {notice && <p role="alert" className="text-sm text-danger-600">{notice}</p>}

      {subjects.length === 0 ? (
        <EmptyState title="No subjects yet" description="Add the subjects your school teaches, then tick the grades that take each." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4 min-w-48">Subject</th>
                {grades.map((g) => (
                  <th key={g.id} className="py-2 px-1 text-center font-medium whitespace-nowrap" title={g.name}>{g.code}</th>
                ))}
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className={`border-b border-subtle last:border-0 ${s.is_active ? '' : 'opacity-60'}`}>
                  <td className="py-2 pr-4">
                    <div className="text-primary font-medium">{s.name}</div>
                    <div className="text-xs text-muted font-mono">{s.code}{s.is_active ? '' : ' · inactive'}</div>
                  </td>
                  {grades.map((g) => (
                    <td key={g.id} className="py-2 px-1 text-center">
                      <input type="checkbox" aria-label={`${g.name} takes ${s.name}`}
                        checked={s.grade_level_ids.includes(g.id)}
                        disabled={busy !== null}
                        onChange={() => toggle(s, g.id)} />
                    </td>
                  ))}
                  <td className="py-2 pl-3 whitespace-nowrap">
                    <button className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => allGrades(s)}>
                      {s.grade_level_ids.length === grades.length ? 'None' : 'All grades'}
                    </button>
                    <button className="btn btn-ghost text-xs" disabled={busy !== null}
                      onClick={() => void act(s.id, () => gradeSchoolService.updateSubject(s.id, { isActive: !s.is_active }))}>
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="btn btn-ghost text-xs text-danger-600" disabled={busy !== null} title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete ${s.name}?`)) void act(s.id, () => gradeSchoolService.deleteSubject(s.id));
                      }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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

export default SchoolAdminSubjectsPage;
