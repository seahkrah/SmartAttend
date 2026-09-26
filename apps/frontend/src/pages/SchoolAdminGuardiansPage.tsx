/**
 * The school's guardians: parents, carers and sponsors, who they are
 * responsible for, what each may see, and whether they have a portal account.
 *
 * A guardian is recorded before they are invited. Absence alerts and fee
 * notices go to their phone and email whether or not they ever sign in; the
 * portal account is an optional second step taken from this page.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Search, Users, Mail, Link2, Star, Copy, X, Phone, KeyRound,
} from 'lucide-react';
import { apiClient } from '../services/api';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';
import {
  guardiansAdminService, RELATIONSHIPS,
  type Guardian, type GuardianLink, type Invitation, type Relationship, type AccountState,
} from '../services/guardianService';

interface StudentOption { id: string; student_id: string | null; first_name: string; last_name: string }

const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '', address: '', occupation: '', notes: '',
  studentId: '', relationship: 'guardian' as Relationship, isPrimary: false,
};

const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;

const ACCOUNT_BADGE: Record<AccountState, { label: string; cls: string }> = {
  none: { label: 'No account', cls: 'badge badge-neutral' },
  invited: { label: 'Invited', cls: 'badge badge-warning' },
  active: { label: 'Active', cls: 'badge badge-success' },
  disabled: { label: 'Disabled', cls: 'badge badge-danger' },
};

const label = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

const PERMISSIONS: Array<{ key: keyof GuardianLink; api: string; text: string }> = [
  { key: 'can_view_attendance', api: 'canViewAttendance', text: 'Attendance' },
  { key: 'can_view_results', api: 'canViewResults', text: 'Results' },
  { key: 'can_view_fees', api: 'canViewFees', text: 'Fees' },
  { key: 'receives_notifications', api: 'receivesNotifications', text: 'Notifications' },
];

const SchoolAdminGuardiansPage: React.FC = () => {
  const [rows, setRows] = useState<Guardian[] | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const [editing, setEditing] = useState<Guardian | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [managing, setManaging] = useState<Guardian | null>(null);
  const [handover, setHandover] = useState<{ name: string; invitation: Invitation } | null>(null);

  const load = async (term = search) => {
    setError(null);
    try {
      setRows(await guardiansAdminService.list(term ? { search: term } : {}));
    } catch (e) {
      setError(errorOf(e, 'Guardians could not be loaded'));
    }
  };

  useEffect(() => {
    void load('');
    apiClient.get('/auth/admin/school/students')
      .then((r) => setStudents(r.data.students))
      .catch(() => setStudents([]));
  }, []);

  // Search as the office types, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const open = (g: Guardian | 'new') => {
    setEditing(g);
    setFormError(null);
    setForm(g === 'new' ? EMPTY_FORM : {
      ...EMPTY_FORM,
      firstName: g.first_name, lastName: g.last_name, email: g.email ?? '', phone: g.phone ?? '',
      address: g.address ?? '', occupation: g.occupation ?? '', notes: g.notes ?? '',
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const details = {
      firstName: form.firstName, lastName: form.lastName,
      email: form.email || null, phone: form.phone || null, address: form.address || null,
      occupation: form.occupation || null, notes: form.notes || null,
    };
    try {
      if (editing === 'new') {
        await guardiansAdminService.create({
          ...details,
          students: form.studentId
            ? [{ studentId: form.studentId, relationship: form.relationship, isPrimary: form.isPrimary }]
            : [],
        });
        setNotice({ tone: 'ok', text: `${form.firstName} ${form.lastName} recorded.` });
      } else if (editing) {
        const updated = await guardiansAdminService.update(editing.id, details);
        if (managing?.id === updated.id) setManaging(updated);
        setNotice({ tone: 'ok', text: 'Guardian updated.' });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(errorOf(err, 'The guardian could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Guardian) => {
    const account = g.user_id ? ' Their portal account will lose access to this school.' : '';
    if (!confirm(`Remove ${g.first_name} ${g.last_name} as a guardian?${account}`)) return;
    try {
      await guardiansAdminService.remove(g.id);
      if (managing?.id === g.id) setManaging(null);
      setNotice({ tone: 'ok', text: `${g.first_name} ${g.last_name} removed.` });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: errorOf(err, 'The guardian could not be removed') });
    }
  };

  const invite = async (g: Guardian, byHandover: boolean) => {
    try {
      const r = await guardiansAdminService.invite(g.id, byHandover);
      if (managing?.id === g.id) setManaging(r.guardian);
      if (r.invitation?.delivery === 'handover') {
        setHandover({ name: `${g.first_name} ${g.last_name}`, invitation: r.invitation });
      } else if (r.invitation) {
        setNotice(r.invitation.delivery === 'email'
          ? { tone: 'ok', text: `Invitation emailed to ${g.email}.` }
          : {
              tone: 'error',
              text: r.invitation.delivery === 'simulated'
                ? `Email is not configured for your school yet, so the invitation to ${g.email} was recorded but not sent. Use "Setup link" to hand it over instead.`
                : `The invitation could not be sent${r.invitation.reason ? ` (${r.invitation.reason})` : ''}. Use "Setup link" to hand it over instead.`,
            });
      } else {
        setNotice({ tone: 'ok', text: `${g.first_name} already has a guardian account; this school has been added to it.` });
      }
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: errorOf(err, 'The invitation could not be sent') });
    }
  };

  const openManage = async (g: Guardian) => {
    try {
      setManaging(await guardiansAdminService.get(g.id));
    } catch (err) {
      setNotice({ tone: 'error', text: errorOf(err, 'That guardian could not be opened') });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Guardians</h1>
          <p className="text-sm text-secondary mt-1">
            Parents, carers and sponsors: who they are responsible for, what they may see, and their portal access.
          </p>
        </div>
        <button className="btn btn-primary flex items-center gap-1" onClick={() => open('new')}>
          <Plus className="w-4 h-4" /> Add guardian
        </button>
      </header>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          className="input-field w-full pl-9"
          placeholder="Search by guardian, phone, email or student"
          aria-label="Search guardians"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${notice.tone === 'error' ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-300'}`}>
          {notice.text}
        </p>
      )}

      {error ? (
        <ErrorState title="Guardians could not be loaded" description={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading guardians…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? 'No guardians match that search' : 'No guardians recorded yet'}
          description={search ? 'Try a name, phone number or student number.' : 'Record a parent or sponsor and link them to their children.'}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-subtle">
                <th className="py-2 pr-4">Guardian</th>
                <th className="py-2 pr-4">Contact</th>
                <th className="py-2 pr-4">Children</th>
                <th className="py-2 pr-4">Portal</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-b border-subtle align-top">
                  <td className="py-2 pr-4">
                    <button className="font-medium text-primary hover:underline text-left" onClick={() => void openManage(g)}>
                      {g.first_name} {g.last_name}
                    </button>
                    {g.occupation && <div className="text-xs text-muted">{g.occupation}</div>}
                  </td>
                  <td className="py-2 pr-4 text-secondary">
                    {g.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{g.phone}</div>}
                    {g.email && <div className="flex items-center gap-1 break-all"><Mail className="w-3 h-3" />{g.email}</div>}
                  </td>
                  <td className="py-2 pr-4">
                    {g.students.length === 0 ? (
                      <span className="text-muted">None linked</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {g.students.map((s: any) => (
                          <span key={s.link_id ?? s.id} className="badge badge-neutral whitespace-nowrap" title={label(s.relationship)}>
                            {s.is_primary && <Star className="w-3 h-3 mr-1 inline" aria-label="Primary contact" />}
                            {s.first_name} {s.last_name}
                            <span className="text-muted ml-1">· {label(s.relationship)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`${ACCOUNT_BADGE[g.account].cls} whitespace-nowrap`}>{ACCOUNT_BADGE[g.account].label}</span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button className="btn btn-ghost" aria-label={`Children and access for ${g.first_name} ${g.last_name}`}
                      title="Children and access" onClick={() => void openManage(g)}>
                      <Link2 className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost" aria-label={`Edit ${g.first_name} ${g.last_name}`} title="Edit"
                      onClick={() => open(g)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost" aria-label={`Remove ${g.first_name} ${g.last_name}`} title="Remove"
                      onClick={() => void remove(g)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <GuardianForm
          editing={editing}
          form={form}
          setForm={setForm}
          students={students}
          error={formError}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSubmit={save}
        />
      )}

      {managing && (
        <ManageGuardian
          guardian={managing}
          students={students}
          onClose={() => { setManaging(null); void load(); }}
          onChange={setManaging}
          onInvite={(byHandover) => void invite(managing, byHandover)}
          onEdit={() => open(managing)}
        />
      )}

      {handover && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="handover-title">
          <div className="card w-full max-w-lg space-y-3">
            <h2 id="handover-title" className="font-semibold text-primary">Setup link for {handover.name}</h2>
            <p className="text-sm text-secondary">
              Give this link to the guardian in person or by a channel you trust. It works once and
              expires in {handover.invitation.expiresInDays ?? 7} days. Nobody at the school will see the password they choose.
            </p>
            <div className="flex gap-2">
              <input className="input-field w-full font-mono text-xs" readOnly value={handover.invitation.link ?? ''}
                aria-label="Setup link" onFocus={(e) => e.currentTarget.select()} />
              <button className="btn btn-secondary flex items-center gap-1"
                onClick={() => void navigator.clipboard?.writeText(handover.invitation.link ?? '')}>
                <Copy className="w-4 h-4" /> Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={() => setHandover(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const GuardianForm: React.FC<{
  editing: Guardian | 'new';
  form: typeof EMPTY_FORM;
  setForm: (f: typeof EMPTY_FORM) => void;
  students: StudentOption[];
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
}> = ({ editing, form, setForm, students, error, saving, onCancel, onSubmit }) => (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="guardian-form">
    <form className="card w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto" onSubmit={onSubmit}>
      <h2 id="guardian-form" className="font-semibold text-primary">
        {editing === 'new' ? 'Add guardian' : `Edit ${editing.first_name} ${editing.last_name}`}
      </h2>
      {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm text-secondary">First name
          <input className="input-field w-full mt-1" required maxLength={100} value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </label>
        <label className="block text-sm text-secondary">Last name
          <input className="input-field w-full mt-1" required maxLength={100} value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </label>
        <label className="block text-sm text-secondary">Phone
          <input className="input-field w-full mt-1" type="tel" maxLength={30} value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="block text-sm text-secondary">Email
          <input className="input-field w-full mt-1" type="email" maxLength={255} value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
      </div>
      <p className="text-xs text-muted">At least one of phone or email is needed. A portal account needs an email address.</p>
      <label className="block text-sm text-secondary">Occupation (optional)
        <input className="input-field w-full mt-1" maxLength={150} value={form.occupation}
          onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
      </label>
      <label className="block text-sm text-secondary">Address (optional)
        <textarea className="input-field w-full mt-1" rows={2} maxLength={500} value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <label className="block text-sm text-secondary">Notes (optional, staff only)
        <textarea className="input-field w-full mt-1" rows={2} maxLength={2000} value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>

      {editing === 'new' && (
        <fieldset className="border border-subtle rounded-lg p-3 space-y-2">
          <legend className="text-sm text-secondary px-1">Link to a student (optional)</legend>
          <select className="input-field w-full" aria-label="Student" value={form.studentId}
            onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            <option value="">No student yet</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.first_name} {s.last_name}{s.student_id ? ` (${s.student_id})` : ''}
              </option>
            ))}
          </select>
          {form.studentId && (
            <div className="flex flex-wrap items-center gap-3">
              <select className="input-field" aria-label="Relationship" value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value as Relationship })}>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input type="checkbox" checked={form.isPrimary}
                  onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                Primary contact
              </label>
            </div>
          )}
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </div>
);

// ---------------------------------------------------------------------------

const ManageGuardian: React.FC<{
  guardian: Guardian;
  students: StudentOption[];
  onClose: () => void;
  onChange: (g: Guardian) => void;
  onInvite: (handover: boolean) => void;
  onEdit: () => void;
}> = ({ guardian, students, onClose, onChange, onInvite, onEdit }) => {
  const links = guardian.students as GuardianLink[];
  const [adding, setAdding] = useState({ studentId: '', relationship: 'guardian' as Relationship });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = useMemo(() => new Set(links.map((l) => l.student_id)), [links]);
  const available = students.filter((s) => !linked.has(s.id));

  const run = async (fn: () => Promise<Guardian>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
    } catch (err) {
      setError(errorOf(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const canInvite = guardian.account === 'none' || guardian.account === 'invited';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="manage-title">
      <div className="card w-full max-w-3xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="manage-title" className="font-semibold text-primary text-lg">
              {guardian.first_name} {guardian.last_name}
            </h2>
            <p className="text-sm text-secondary">
              {[guardian.phone, guardian.email].filter(Boolean).join(' · ') || 'No contact details'}
            </p>
          </div>
          <button className="btn btn-ghost" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

        <section className="rounded-lg border border-subtle p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted" />
            <span className="text-sm text-secondary">Parent portal</span>
            <span className={ACCOUNT_BADGE[guardian.account].cls}>{ACCOUNT_BADGE[guardian.account].label}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {canInvite && guardian.email && (
              <>
                <button className="btn btn-secondary flex items-center gap-1" onClick={() => onInvite(false)}>
                  <Mail className="w-4 h-4" /> {guardian.account === 'invited' ? 'Resend invitation' : 'Email invitation'}
                </button>
                <button className="btn btn-ghost" onClick={() => onInvite(true)}>Setup link</button>
              </>
            )}
            {canInvite && !guardian.email && (
              <button className="btn btn-ghost" onClick={onEdit}>Add an email to invite them</button>
            )}
            {guardian.account === 'active' && (
              <span className="text-xs text-muted">
                Signed in{guardian.last_login ? ` ${new Date(guardian.last_login).toLocaleDateString()}` : ''}.
                Lost access? Reset it from Users.
              </span>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-primary">Children and what they may see</h3>
          {links.length === 0 ? (
            <p className="text-sm text-muted">No students linked yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-subtle">
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3">Relationship</th>
                    <th className="py-2 pr-3">Primary</th>
                    {PERMISSIONS.map((p) => <th key={p.api} className="py-2 pr-3">{p.text}</th>)}
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} className="border-b border-subtle">
                      <td className="py-2 pr-3">
                        <div className="text-primary">{l.first_name} {l.last_name}</div>
                        {l.student_number && <div className="text-xs text-muted">{l.student_number}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <select className="input-field py-1" aria-label={`Relationship to ${l.first_name}`}
                          value={l.relationship} disabled={busy}
                          onChange={(e) => void run(() => guardiansAdminService.updateLink(
                            guardian.id, l.id, { relationship: e.target.value as Relationship }),
                          'The relationship could not be changed')}>
                          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="checkbox" aria-label={`Primary contact for ${l.first_name}`}
                          checked={l.is_primary} disabled={busy}
                          onChange={(e) => void run(() => guardiansAdminService.updateLink(
                            guardian.id, l.id, { isPrimary: e.target.checked }),
                          'The primary contact could not be changed')} />
                      </td>
                      {PERMISSIONS.map((p) => (
                        <td key={p.api} className="py-2 pr-3">
                          <input type="checkbox" aria-label={`${p.text} for ${l.first_name}`}
                            checked={!!l[p.key]} disabled={busy}
                            onChange={(e) => void run(() => guardiansAdminService.updateLink(
                              guardian.id, l.id, { [p.api]: e.target.checked }),
                            'That permission could not be changed')} />
                        </td>
                      ))}
                      <td className="py-2 text-right">
                        <button className="btn btn-ghost" aria-label={`Unlink ${l.first_name}`} disabled={busy}
                          onClick={() => {
                            if (confirm(`Unlink ${l.first_name} ${l.last_name} from ${guardian.first_name}?`)) {
                              void run(() => guardiansAdminService.unlink(guardian.id, l.id), 'The student could not be unlinked');
                            }
                          }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-2">
            <label className="text-sm text-secondary flex-1 min-w-[12rem]">Link another student
              <select className="input-field w-full mt-1" value={adding.studentId}
                onChange={(e) => setAdding({ ...adding, studentId: e.target.value })}>
                <option value="">Choose a student</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first_name} {s.last_name}{s.student_id ? ` (${s.student_id})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-secondary">Relationship
              <select className="input-field w-full mt-1" value={adding.relationship}
                onChange={(e) => setAdding({ ...adding, relationship: e.target.value as Relationship })}>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>
            </label>
            <button className="btn btn-primary flex items-center gap-1" disabled={!adding.studentId || busy}
              onClick={() => void run(async () => {
                const g = await guardiansAdminService.link(guardian.id, adding.studentId, { relationship: adding.relationship });
                setAdding({ studentId: '', relationship: 'guardian' });
                return g;
              }, 'The student could not be linked')}>
              <Plus className="w-4 h-4" /> Link
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SchoolAdminGuardiansPage;
