/**
 * The school's departments: names, codes, heads, and what is in each.
 *
 * Departments were previously created only as a side effect of typing a new
 * name on a student or lecturer form, with nowhere to correct or remove one.
 */
import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { apiClient } from '../services/api';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

interface Department {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  head_id: string | null;
  head_name: string | null;
  students: number;
  faculty: number;
  courses: number;
  programmes: number;
}

interface Lecturer { user_id: string; full_name: string }

const EMPTY = { name: '', code: '', description: '', headUserId: '' };
const errorOf = (e: any, fallback: string) => {
  const d = e?.response?.data;
  if (d?.inUse) {
    const parts = Object.entries(d.inUse as Record<string, number>).map(([k, n]) => `${n} ${k}`);
    return `${d.error}: ${parts.join(', ')}.`;
  }
  return d?.error ?? fallback;
};

const SchoolAdminDepartmentsPage: React.FC = () => {
  const [rows, setRows] = useState<Department[] | null>(null);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [d, f] = await Promise.all([
        apiClient.get('/auth/admin/school/departments'),
        apiClient.get('/auth/admin/school/faculty'),
      ]);
      setRows(d.data.departments);
      setLecturers(f.data.faculty.map((x: any) => ({ user_id: x.user_id, full_name: x.full_name })));
    } catch (e: any) {
      setError(errorOf(e, 'Departments could not be loaded'));
    }
  };

  useEffect(() => { void load(); }, []);

  const open = (d: Department | 'new') => {
    setEditing(d);
    setFormError(null);
    setForm(d === 'new' ? EMPTY : {
      name: d.name, code: d.code ?? '', description: d.description ?? '', headUserId: d.head_id ?? '',
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = { name: form.name, code: form.code, description: form.description, headUserId: form.headUserId || null };
    try {
      if (editing === 'new') await apiClient.post('/auth/admin/school/departments', body);
      else if (editing) await apiClient.put(`/auth/admin/school/departments/${editing.id}`, body);
      setEditing(null);
      await load();
    } catch (err: any) {
      setFormError(errorOf(err, 'The department could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Department) => {
    if (!confirm(`Remove the ${d.name} department?`)) return;
    setNotice(null);
    try {
      await apiClient.delete(`/auth/admin/school/departments/${d.id}`);
      await load();
    } catch (err: any) {
      setNotice(errorOf(err, 'The department could not be removed'));
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Departments</h1>
          <p className="text-sm text-secondary mt-1">Each student, lecturer, course and programme can belong to one.</p>
        </div>
        <button className="btn btn-primary flex items-center gap-1" onClick={() => open('new')}>
          <Plus className="w-4 h-4" /> Add department
        </button>
      </header>

      {notice && <p role="alert" className="text-sm text-danger-600">{notice}</p>}

      {error ? (
        <ErrorState title="Departments could not be loaded" description={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading departments…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No departments yet" description="Add one, or they are created when you enter a new department name for a student or lecturer." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">Department</th>
                <th className="py-2 pr-4">Head</th>
                <th className="py-2 pr-4 text-right">Students</th>
                <th className="py-2 pr-4 text-right">Lecturers</th>
                <th className="py-2 pr-4 text-right">Courses</th>
                <th className="py-2 pr-4 text-right">Programmes</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-subtle">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-primary">{d.name}{d.code && <span className="ml-2 badge badge-neutral">{d.code}</span>}</div>
                    {d.description && <div className="text-xs text-muted">{d.description}</div>}
                  </td>
                  <td className="py-2 pr-4 text-secondary">{d.head_name ?? '—'}</td>
                  <td className="py-2 pr-4 text-right">{d.students}</td>
                  <td className="py-2 pr-4 text-right">{d.faculty}</td>
                  <td className="py-2 pr-4 text-right">{d.courses}</td>
                  <td className="py-2 pr-4 text-right">{d.programmes}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button className="btn btn-ghost" aria-label={`Edit ${d.name}`} onClick={() => open(d)}><Pencil className="w-4 h-4" /></button>
                    <button className="btn btn-ghost" aria-label={`Remove ${d.name}`} onClick={() => void remove(d)}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="dept-form">
          <form className="card w-full max-w-lg space-y-3" onSubmit={save}>
            <h2 id="dept-form" className="font-semibold text-primary">{editing === 'new' ? 'Add department' : `Edit ${editing.name}`}</h2>
            {formError && <p role="alert" className="text-sm text-danger-600">{formError}</p>}
            <label className="block text-sm text-secondary">Name
              <input className="input-field w-full mt-1" required minLength={2} maxLength={120} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-sm text-secondary">Code (optional)
              <input className="input-field w-full mt-1" maxLength={20} value={form.code} placeholder="e.g. CSC"
                onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </label>
            <label className="block text-sm text-secondary">Head of department
              <select className="input-field w-full mt-1" value={form.headUserId}
                onChange={(e) => setForm({ ...form, headUserId: e.target.value })}>
                <option value="">None</option>
                {lecturers.map((l) => <option key={l.user_id} value={l.user_id}>{l.full_name}</option>)}
              </select>
            </label>
            <label className="block text-sm text-secondary">Description (optional)
              <textarea className="input-field w-full mt-1" rows={3} maxLength={2000} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SchoolAdminDepartmentsPage;
