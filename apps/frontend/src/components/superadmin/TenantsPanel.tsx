/**
 * The superadmin's tenants: create a school or company, set a school's type
 * and levels, move a tenant through its lifecycle, and delete an empty one.
 *
 * A school is created as a TYPE (grade school, vocational, college,
 * university) offering chosen LEVELS, and the tools its people are given
 * follow from them. The catalogue comes from the API; nothing here repeats it.
 *
 * Rules the API enforces, and this panel explains rather than hides:
 *   - levels can be added at any time; a level can be removed only while
 *     nothing is placed in its grades;
 *   - the type is fixed once the school has a student;
 *   - moving a tenant's lifecycle needs a justification, which goes into the
 *     audit trail; an archived tenant cannot come back;
 *   - a tenant that holds data cannot be deleted, only archived.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Edit3, GraduationCap, PauseCircle, Play, Plus, Archive, Trash2, X } from 'lucide-react';
import { apiClient } from '../../services/api';
import { schoolTypesService, type SchoolType, type SchoolTypeDef } from '../../services/schoolTypesService';
import { EmptyState, ErrorState, LoadingState } from '../states/PageStates';

type Lifecycle = 'active' | 'suspended' | 'archived';

interface TenantRow {
  id: string;
  name: string;
  code: string;
  kind: 'school' | 'corporate';
  status: Lifecycle;
  user_count: number;
  member_count: number;
  school_type: SchoolType | null;
  school_stages: string[] | null;
}

type Notify = (type: 'success' | 'error' | 'info', title: string, message?: string) => void;

const errorOf = (e: any, fallback: string): string => e?.response?.data?.error ?? fallback;

const LIFECYCLE_LABEL: Record<Lifecycle, { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'badge badge-success' },
  suspended: { label: 'Suspended', badge: 'badge badge-warning' },
  archived: { label: 'Archived', badge: 'badge' },
};

// ---------------------------------------------------------------------------
// Type and levels picker, shared by create and edit
// ---------------------------------------------------------------------------

const StructurePicker: React.FC<{
  types: SchoolTypeDef[];
  type: SchoolType | '';
  stages: string[];
  typeLocked?: boolean;
  onChange: (type: SchoolType, stages: string[]) => void;
}> = ({ types, type, stages, typeLocked, onChange }) => {
  const def = types.find((t) => t.key === type);
  const toggle = (key: string) =>
    def && onChange(def.key, stages.includes(key) ? stages.filter((s) => s !== key) : [...stages, key]);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="block text-sm font-medium text-secondary mb-2">Type of school</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {types.map((t) => {
            const selected = t.key === type;
            const disabled = typeLocked && !selected;
            return (
              <label
                key={t.key}
                className={[
                  'flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  selected ? 'border-brand-500 bg-card' : 'border-subtle bg-sunken hover:border-strong',
                  disabled ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="school_type"
                  className="mt-1"
                  checked={selected}
                  disabled={disabled}
                  // A new type starts with its first level offered, so the form
                  // is never in the state the API refuses.
                  onChange={() => onChange(t.key, [t.stages[0].key])}
                />
                <span>
                  <span className="block font-semibold text-primary">{t.label}</span>
                  <span className="block text-xs text-muted mt-0.5">{t.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {typeLocked && (
          <p className="text-xs text-muted mt-2">
            The type cannot change once the school has students: its records are shaped by it.
          </p>
        )}
      </fieldset>

      {def && (
        <fieldset>
          <legend className="block text-sm font-medium text-secondary mb-2">Levels offered</legend>
          <div className="space-y-2">
            {def.stages.map((s) => (
              <label key={s.key} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={stages.includes(s.key)}
                  onChange={() => toggle(s.key)}
                />
                <span>
                  <span className="text-primary font-medium">{s.label}</span>
                  {s.grades && (
                    <span className="text-muted"> — {s.grades.map((g) => g.name).join(', ')}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {stages.length === 0 && <p className="text-xs text-danger-600 mt-2">Choose at least one level.</p>}
        </fieldset>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  kind: 'school' as 'school' | 'corporate',
  name: '',
  code: '',
  email: '',
  phone: '',
  address: '',
  school_type: '' as SchoolType | '',
  school_stages: [] as string[],
};

export const TenantsPanel: React.FC<{ notify: Notify }> = ({ notify }) => {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [types, setTypes] = useState<SchoolTypeDef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [edit, setEdit] = useState({ name: '', school_type: '' as SchoolType | '', school_stages: [] as string[] });
  const [moving, setMoving] = useState<{ tenant: TenantRow; to: Lifecycle } | null>(null);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, catalogue] = await Promise.all([
        apiClient.get('/superadmin/tenants'),
        schoolTypesService.listTypes(),
      ]);
      setTenants(t.data.tenants ?? []);
      setTypes(catalogue);
    } catch (e) {
      setError(errorOf(e, 'Tenants could not be loaded'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const typeLabel = useMemo(() => {
    const byKey = new Map(types.map((t) => [t.key, t]));
    return (t: TenantRow) => {
      if (t.kind !== 'school') return 'Company';
      const def = byKey.get(t.school_type ?? 'university');
      if (!def) return 'School';
      const levels = def.stages.filter((s) => t.school_stages?.includes(s.key)).map((s) => s.label);
      return levels.length ? `${def.label} · ${levels.join(', ')}` : def.label;
    };
  }, [types]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        kind: form.kind, name: form.name.trim(), code: form.code.trim(),
        email: form.email || null, phone: form.phone || null, address: form.address || null,
      };
      if (form.kind === 'school') {
        body.school_type = form.school_type;
        body.school_stages = form.school_stages;
      }
      await apiClient.post('/superadmin/tenants', body);
      notify('success', 'Tenant created', `${form.name} (${form.code})`);
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
    } catch (err) {
      notify('error', 'Tenant not created', errorOf(err, 'The tenant could not be created'));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (t: TenantRow) => {
    setEditing(t);
    setEdit({
      name: t.name,
      school_type: t.kind === 'school' ? t.school_type ?? 'university' : '',
      school_stages: t.school_stages ?? [],
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: edit.name.trim() };
      if (editing.kind === 'school') {
        body.school_type = edit.school_type;
        body.school_stages = edit.school_stages;
      }
      await apiClient.patch(`/superadmin/tenants/${editing.id}`, body);
      notify('success', 'Tenant updated', edit.name);
      setEditing(null);
      await load();
    } catch (err) {
      notify('error', 'Tenant not updated', errorOf(err, 'The tenant could not be updated'));
    } finally {
      setBusy(false);
    }
  };

  const move = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    setBusy(true);
    try {
      const r = await apiClient.post(`/superadmin/tenants/${moving.tenant.id}/lifecycle`, {
        state: moving.to, justification: justification.trim(),
      });
      notify('success', `${moving.tenant.name} is now ${moving.to}`, r.data?.note);
      setMoving(null);
      setJustification('');
      await load();
    } catch (err) {
      notify('error', 'Not moved', errorOf(err, 'The tenant could not be moved'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: TenantRow) => {
    if (!window.confirm(`Delete "${t.name}"? Only a tenant with no people or records can be deleted.`)) return;
    try {
      await apiClient.delete(`/superadmin/tenants/${t.id}`);
      notify('success', 'Tenant deleted', t.name);
      await load();
    } catch (err) {
      notify('error', 'Not deleted', errorOf(err, 'The tenant could not be deleted'));
    }
  };

  const canSubmitCreate =
    form.name.trim() && form.code.trim() &&
    (form.kind === 'corporate' || (form.school_type && form.school_stages.length > 0));

  const input = 'w-full px-3 py-2 bg-card border border-subtle rounded-lg text-primary placeholder:text-muted outline-none focus:border-brand-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Each school or company is a tenant. A school's type and levels decide the tools its people get.
        </p>
        <button className="btn btn-primary flex items-center gap-1" onClick={() => setCreating((v) => !v)}>
          {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {creating ? 'Cancel' : 'New tenant'}
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="card space-y-5">
          <fieldset>
            <legend className="block text-sm font-medium text-secondary mb-2">This tenant is a</legend>
            <div className="flex gap-2">
              {(['school', 'corporate'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, kind: k })}
                  className={form.kind === k ? 'btn btn-primary' : 'btn btn-secondary'}
                  aria-pressed={form.kind === k}
                >
                  {k === 'school' ? <GraduationCap className="w-4 h-4 mr-1 inline" /> : <Building2 className="w-4 h-4 mr-1 inline" />}
                  {k === 'school' ? 'School' : 'Company'}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Name</span>
              <input className={input} value={form.name} required
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Code</span>
              <input className={`${input} font-mono`} value={form.code} required maxLength={50}
                placeholder="e.g. SJHS-MON"
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Email</span>
              <input className={input} type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Phone</span>
              <input className={input} value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="block md:col-span-2">
              <span className="block text-sm font-medium text-secondary mb-1">Address</span>
              <input className={input} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
          </div>

          {form.kind === 'school' && (
            <StructurePicker
              types={types}
              type={form.school_type}
              stages={form.school_stages}
              onChange={(school_type, school_stages) => setForm({ ...form, school_type, school_stages })}
            />
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy || !canSubmitCreate}>
              {busy ? 'Creating…' : 'Create tenant'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {error ? (
        <ErrorState title="Tenants could not be loaded" description={error} onRetry={() => void load()} />
      ) : tenants === null ? (
        <LoadingState label="Loading tenants…" />
      ) : tenants.length === 0 ? (
        <EmptyState title="No tenants yet" description="Create a school or a company to get started." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">Tenant</th>
                <th className="py-2 pr-4">Type and levels</th>
                <th className="py-2 pr-4">People</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const lc = LIFECYCLE_LABEL[t.status] ?? LIFECYCLE_LABEL.active;
                return (
                  <tr key={t.id} className="border-b border-subtle last:border-0 align-top">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-primary">{t.name}</div>
                      <div className="text-xs text-muted font-mono">{t.code}</div>
                    </td>
                    <td className="py-3 pr-4 text-secondary">{typeLabel(t)}</td>
                    <td className="py-3 pr-4 text-secondary tabular-nums">
                      {t.member_count} {t.kind === 'school' ? 'students' : 'employees'} · {t.user_count} accounts
                    </td>
                    <td className="py-3 pr-4"><span className={lc.badge}>{lc.label}</span></td>
                    <td className="py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {t.status !== 'archived' && (
                          <button className="btn btn-ghost text-xs" onClick={() => openEdit(t)} title="Edit">
                            <Edit3 className="w-3.5 h-3.5 inline mr-1" />Edit
                          </button>
                        )}
                        {t.status === 'suspended' && (
                          <button className="btn btn-ghost text-xs" onClick={() => setMoving({ tenant: t, to: 'active' })}>
                            <Play className="w-3.5 h-3.5 inline mr-1" />Reactivate
                          </button>
                        )}
                        {t.status === 'active' && (
                          <button className="btn btn-ghost text-xs" onClick={() => setMoving({ tenant: t, to: 'suspended' })}>
                            <PauseCircle className="w-3.5 h-3.5 inline mr-1" />Suspend
                          </button>
                        )}
                        {t.status !== 'archived' && (
                          <button className="btn btn-ghost text-xs" onClick={() => setMoving({ tenant: t, to: 'archived' })}>
                            <Archive className="w-3.5 h-3.5 inline mr-1" />Archive
                          </button>
                        )}
                        <button className="btn btn-ghost text-xs text-danger-600" onClick={() => void remove(t)}>
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" />Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <form onSubmit={saveEdit} className="card w-full max-w-2xl space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-primary">Edit {editing.name}</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-secondary hover:text-primary" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Name</span>
              <input className={input} value={edit.name} required onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            {editing.kind === 'school' && (
              <StructurePicker
                types={types}
                type={edit.school_type}
                stages={edit.school_stages}
                typeLocked={editing.member_count > 0}
                onChange={(school_type, school_stages) => setEdit({ ...edit, school_type, school_stages })}
              />
            )}
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary"
                disabled={busy || !edit.name.trim() || (editing.kind === 'school' && edit.school_stages.length === 0)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {moving && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form onSubmit={move} className="card w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-primary">
              {moving.to === 'active' ? 'Reactivate' : moving.to === 'suspended' ? 'Suspend' : 'Archive'} {moving.tenant.name}
            </h3>
            <p className="text-sm text-secondary">
              {moving.to === 'suspended' && 'Its people cannot sign in until it is reactivated. No data is touched.'}
              {moving.to === 'archived' && 'This ends the relationship. Its people cannot sign in, and an archived tenant cannot be brought back.'}
              {moving.to === 'active' && 'Its people can sign in again. Accounts locked with it are not reopened automatically; reactivate them one by one.'}
            </p>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Why? (recorded in the audit trail)</span>
              <textarea className={input} rows={3} required value={justification}
                onChange={(e) => setJustification(e.target.value)} />
            </label>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary" disabled={busy || !justification.trim()}>
                {busy ? 'Working…' : 'Confirm'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setMoving(null); setJustification(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default TenantsPanel;
