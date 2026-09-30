import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Layers, Plus, Send, X,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, ErrorAlert } from '../components/ErrorDisplay';
import hrService, { type MemberAttendanceSummary } from '../services/hrService';
import {
  workforceService,
  formatHours,
  isoDay,
  shortTime,
  sumHours,
  type CoverageDay,
  type RosterShift,
  type ShiftPattern,
} from '../services/workforceService';

/**
 * Shifts and rosters.
 *
 * A fortnight at a time, because that is the unit a rota is planned and
 * published in. Each person is a row and each day a column, so the gaps are
 * visible — a gap is the thing a scheduler is looking for, and a list of
 * shifts sorted by date hides them.
 *
 * Publishing is a deliberate, separate step. A roster nobody has seen can be
 * rearranged freely; one that has been published is what people have arranged
 * their lives around, so the API refuses to retime a published shift and this
 * page offers cancel instead.
 */

const DAY_MS = 86_400_000;

function mondayOf(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const shift = (copy.getUTCDay() + 6) % 7;
  return new Date(copy.getTime() - shift * DAY_MS);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const HRRosterPage: React.FC = () => {
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()));
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [coverage, setCoverage] = useState<CoverageDay[]>([]);
  const [members, setMembers] = useState<MemberAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPatterns, setShowPatterns] = useState(false);
  const [patternForm, setPatternForm] = useState({
    code: '', name: '', startTime: '09:00', endTime: '17:00',
    breakMinutes: '30', colour: '#3366CC',
  });

  const [showAssign, setShowAssign] = useState(false);
  const [assign, setAssign] = useState({
    employeeId: '', patternId: '', mode: 'week' as 'day' | 'week',
    workDate: '', from: '', to: '', weekdays: [1, 2, 3, 4, 5] as number[],
  });
  const [clashes, setClashes] = useState<Array<{ workDate: string; reason: string }>>([]);

  const { addToast } = useToastStore();

  const from = iso(anchor);
  const to = iso(new Date(anchor.getTime() + 13 * DAY_MS));
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => iso(new Date(anchor.getTime() + i * DAY_MS))),
    [anchor]
  );

  useEffect(() => { void load(); }, [from]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [r, p, cov, m] = await Promise.all([
        workforceService.roster(from, to),
        workforceService.listPatterns(),
        workforceService.coverage(from, to).catch(() => []),
        hrService.listMembers(1, 200).catch(() => ({ members: [], page: 1, pageSize: 200, total: 0 })),
      ]);
      setShifts(r.shifts);
      setPatterns(p);
      setCoverage(cov);
      setMembers(m.members.filter((x: MemberAttendanceSummary) => x.role === 'EMPLOYEE'));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const fail = (title: string, e: unknown) =>
    addToast({ type: 'error', title, message: getErrorMessage(e) });

  const savePattern = async () => {
    try {
      setBusy(true);
      await workforceService.createPattern({
        code: patternForm.code.trim(),
        name: patternForm.name.trim(),
        startTime: patternForm.startTime,
        endTime: patternForm.endTime,
        breakMinutes: Number(patternForm.breakMinutes),
        colour: patternForm.colour,
      });
      setPatternForm({
        code: '', name: '', startTime: '09:00', endTime: '17:00',
        breakMinutes: '30', colour: '#3366CC',
      });
      addToast({ type: 'success', title: 'Pattern added' });
      setPatterns(await workforceService.listPatterns());
    } catch (e) {
      fail('Could not add the pattern', e);
    } finally {
      setBusy(false);
    }
  };

  const deletePattern = async (p: ShiftPattern) => {
    try {
      setBusy(true);
      await workforceService.deletePattern(p.id);
      setPatterns(await workforceService.listPatterns());
    } catch (e) {
      fail('Could not delete the pattern', e);
    } finally {
      setBusy(false);
    }
  };

  const doAssign = async () => {
    try {
      setBusy(true);
      setClashes([]);
      if (assign.mode === 'day') {
        await workforceService.rosterShift({
          employeeId: assign.employeeId,
          patternId: assign.patternId || null,
          workDate: assign.workDate,
        });
        addToast({ type: 'success', title: 'Shift rostered' });
      } else {
        const result = await workforceService.rosterBulk({
          employeeId: assign.employeeId,
          patternId: assign.patternId || null,
          from: assign.from,
          to: assign.to,
          weekdays: assign.weekdays,
        });
        setClashes(result.clashes);
        addToast({
          type: result.clashes.length ? 'warning' : 'success',
          title: `${result.rostered} shift(s) rostered`,
          message: result.clashes.length
            ? `${result.clashes.length} day(s) clashed and were left alone.`
            : undefined,
        });
      }
      setShowAssign(false);
      await load();
    } catch (e) {
      fail('Could not roster that', e);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    try {
      setBusy(true);
      const n = await workforceService.publishRoster(from, to);
      addToast({
        type: n > 0 ? 'success' : 'info',
        title: n > 0 ? `${n} shift(s) published` : 'Nothing to publish',
        message: n > 0 ? 'Everyone with a shift in this fortnight has been told.' : undefined,
      });
      await load();
    } catch (e) {
      fail('Could not publish the roster', e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (s: RosterShift) => {
    const reason = window.prompt(`Why is ${s.name} on ${isoDay(s.work_date)} being cancelled?`);
    if (!reason) return;
    try {
      setBusy(true);
      await workforceService.cancelShift(s.id, reason);
      addToast({ type: 'success', title: 'Shift cancelled' });
      await load();
    } catch (e) {
      fail('Could not cancel the shift', e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingOverlay message="Loading the roster…" />;

  // One row per person who has anything in the fortnight.
  const byPerson = new Map<string, { name: string; number: string; days: Map<string, RosterShift[]> }>();
  for (const s of shifts) {
    const key = s.employee_id;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Unknown',
        number: s.employee_number ?? '',
        days: new Map(),
      });
    }
    const day = isoDay(s.work_date);
    const row = byPerson.get(key)!;
    if (!row.days.has(day)) row.days.set(day, []);
    row.days.get(day)!.push(s);
  }
  const rows = [...byPerson.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  const unpublished = shifts.filter((s) => s.status === 'scheduled').length;
  const coverageByDay = new Map(coverage.map((d) => [d.work_date, d]));

  const field = 'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';
  const label = 'mb-1 block text-xs uppercase tracking-wider text-muted';
  const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-500 disabled:opacity-50';
  const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-sm text-secondary hover:bg-sunken disabled:opacity-50';
  const card = 'rounded-xl border border-subtle bg-card';

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Shifts &amp; rosters</h1>
          <p className="mt-1 text-sm text-secondary">
            Who is working when. Published shifts are what people plan around.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={ghost} onClick={() => setShowPatterns((v) => !v)}>
            <Layers className="h-4 w-4" /> Patterns
          </button>
          <button className={ghost} onClick={() => {
            setAssign({
              employeeId: '', patternId: patterns[0]?.id ?? '', mode: 'week',
              workDate: from, from, to, weekdays: [1, 2, 3, 4, 5],
            });
            setShowAssign(true);
          }}>
            <Plus className="h-4 w-4" /> Roster somebody
          </button>
          <button className={primary} disabled={busy || unpublished === 0} onClick={() => void publish()}>
            <Send className="h-4 w-4" />
            {unpublished > 0 ? `Publish ${unpublished}` : 'All published'}
          </button>
        </div>
      </div>

      {error && <ErrorAlert title="Could not load the roster" message={error} onDismiss={() => setError(null)} />}

      <div className="flex items-center gap-3">
        <button className={ghost} onClick={() => setAnchor(new Date(anchor.getTime() - 14 * DAY_MS))}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <span className="text-sm text-secondary">{from} → {to}</span>
        <button className={ghost} onClick={() => setAnchor(new Date(anchor.getTime() + 14 * DAY_MS))}>
          Next <ChevronRight className="h-4 w-4" />
        </button>
        <button className={ghost} onClick={() => setAnchor(mondayOf(new Date()))}>This fortnight</button>
        {unpublished > 0 && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
            {unpublished} not yet published
          </span>
        )}
      </div>

      {showPatterns && (
        <div className={card}>
          <div className="border-b border-subtle px-5 py-3 text-sm font-semibold uppercase tracking-wider text-secondary">
            Shift patterns
          </div>
          <div className="grid gap-3 border-b border-subtle p-5 sm:grid-cols-6">
            <div>
              <label className={label}>Code</label>
              <input className={field} placeholder="EARLY" value={patternForm.code}
                onChange={(e) => setPatternForm({ ...patternForm, code: e.target.value })} />
            </div>
            <div>
              <label className={label}>Name</label>
              <input className={field} placeholder="Early" value={patternForm.name}
                onChange={(e) => setPatternForm({ ...patternForm, name: e.target.value })} />
            </div>
            <div>
              <label className={label}>Starts</label>
              <input type="time" className={field} value={patternForm.startTime}
                onChange={(e) => setPatternForm({ ...patternForm, startTime: e.target.value })} />
            </div>
            <div>
              <label className={label}>Ends</label>
              <input type="time" className={field} value={patternForm.endTime}
                onChange={(e) => setPatternForm({ ...patternForm, endTime: e.target.value })} />
            </div>
            <div>
              <label className={label}>Break (min)</label>
              <input className={field} inputMode="numeric" value={patternForm.breakMinutes}
                onChange={(e) => setPatternForm({ ...patternForm, breakMinutes: e.target.value })} />
            </div>
            <div>
              <label className={label}>Colour</label>
              <input type="color" className={`${field} h-[38px] p-1`} value={patternForm.colour}
                onChange={(e) => setPatternForm({ ...patternForm, colour: e.target.value })} />
            </div>
            <div className="sm:col-span-6 flex items-center gap-3">
              <button className={primary} disabled={busy || !patternForm.code || !patternForm.name}
                onClick={() => void savePattern()}>
                Add
              </button>
              <span className="text-xs text-muted">
                An end time at or before the start is a night shift; its hours wrap past midnight.
              </span>
            </div>
          </div>
          {patterns.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted">No patterns yet.</div>
          ) : (
            <ul className="divide-y divide-subtle">
              {patterns.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full"
                      style={{ background: p.colour ?? '#475569' }} />
                    <span className="text-primary">{p.name}</span>
                    <span className="text-xs text-muted">{p.code}</span>
                    <span className="text-xs text-muted">
                      {shortTime(p.start_time)}–{shortTime(p.end_time)}
                      {p.break_minutes > 0 && ` · ${p.break_minutes} min break`}
                      {' · '}{formatHours(p.paid_hours)} h paid
                      {p.crosses_midnight && ' · overnight'}
                    </span>
                  </div>
                  <button className="text-xs text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                    disabled={busy} onClick={() => void deletePattern(p)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showAssign && (
        <div className={card}>
          <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <span className="text-sm font-semibold text-primary">Roster somebody</span>
            <button className={ghost} onClick={() => setShowAssign(false)}>
              <X className="h-4 w-4" /> Close
            </button>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-4">
            <div>
              <label className={label}>Employee</label>
              <select className={field} value={assign.employeeId}
                onChange={(e) => setAssign({ ...assign, employeeId: e.target.value })}>
                <option value="">Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Pattern</label>
              <select className={field} value={assign.patternId}
                onChange={(e) => setAssign({ ...assign, patternId: e.target.value })}>
                {patterns.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({shortTime(p.start_time)}–{shortTime(p.end_time)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>How much</label>
              <select className={field} value={assign.mode}
                onChange={(e) => setAssign({ ...assign, mode: e.target.value as 'day' | 'week' })}>
                <option value="week">A range of days</option>
                <option value="day">One day</option>
              </select>
            </div>
            {assign.mode === 'day' ? (
              <div>
                <label className={label}>Day</label>
                <input type="date" className={field} value={assign.workDate}
                  onChange={(e) => setAssign({ ...assign, workDate: e.target.value })} />
              </div>
            ) : (
              <>
                <div>
                  <label className={label}>From</label>
                  <input type="date" className={field} value={assign.from}
                    onChange={(e) => setAssign({ ...assign, from: e.target.value })} />
                </div>
                <div>
                  <label className={label}>To</label>
                  <input type="date" className={field} value={assign.to}
                    onChange={(e) => setAssign({ ...assign, to: e.target.value })} />
                </div>
                <div className="sm:col-span-3">
                  <label className={label}>Which days</label>
                  <div className="flex flex-wrap gap-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                      <button
                        key={d}
                        onClick={() => setAssign({
                          ...assign,
                          weekdays: assign.weekdays.includes(i)
                            ? assign.weekdays.filter((x) => x !== i)
                            : [...assign.weekdays, i],
                        })}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                          assign.weekdays.includes(i)
                            ? 'border-brand-500 bg-brand-600/20 text-brand-700 dark:text-brand-200'
                            : 'border-subtle text-secondary hover:bg-sunken'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="sm:col-span-4 flex items-center gap-3">
              <button className={primary}
                disabled={busy || !assign.employeeId || (assign.mode === 'week' && assign.weekdays.length === 0)}
                onClick={() => void doAssign()}>
                Roster
              </button>
              <span className="text-xs text-muted">
                Days where the person is already on an overlapping shift are reported rather
                than skipped quietly.
              </span>
            </div>
          </div>
        </div>
      )}

      {clashes.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {clashes.length} day(s) were left alone
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-200/80">
            {clashes.map((c) => <li key={c.workDate}>{c.workDate} — {c.reason}</li>)}
          </ul>
        </div>
      )}

      <div className={`${card} overflow-x-auto`}>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<CalendarDays className="h-8 w-8" />}
              title="Nobody is rostered this fortnight"
              message="Add a shift pattern, then roster people onto it."
            />
          </div>
        ) : (
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-subtle text-left text-xs uppercase tracking-wider text-muted">
                <th className="sticky left-0 bg-card px-4 py-3">Person</th>
                {days.map((d) => {
                  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                  const cov = coverageByDay.get(d);
                  return (
                    <th key={d} className={`px-2 py-3 text-center font-normal ${
                      wd === 0 || wd === 6 ? 'bg-card' : ''
                    }`}>
                      <div className="text-secondary">{d.slice(8)}/{d.slice(5, 7)}</div>
                      <div className="text-[10px] text-muted">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][wd]}
                        {cov ? ` · ${cov.people}` : ''}
                      </div>
                    </th>
                  );
                })}
                <th className="px-3 py-3 text-right">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {rows.map(([id, row]) => (
                <tr key={id}>
                  <td className="sticky left-0 bg-card px-4 py-2">
                    <div className="text-primary">{row.name}</div>
                    <div className="text-xs text-muted">{row.number}</div>
                  </td>
                  {days.map((d) => {
                    const cell = row.days.get(d) ?? [];
                    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return (
                      <td key={d} className={`px-1.5 py-2 align-top ${
                        wd === 0 || wd === 6 ? 'bg-card' : ''
                      }`}>
                        {cell.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => s.status !== 'cancelled' && cancel(s)}
                            title={`${s.name} ${shortTime(s.start_time)}–${shortTime(s.end_time)}`
                              + (s.status === 'cancelled' ? ` (cancelled: ${s.cancel_reason})` : '')}
                            className={`mb-1 block w-full rounded px-1 py-0.5 text-[11px] leading-tight transition ${
                              s.status === 'cancelled'
                                ? 'bg-sunken text-muted line-through'
                                : s.status === 'published'
                                  ? 'text-slate-900 hover:opacity-80'
                                  : 'border border-dashed border-strong text-secondary hover:bg-sunken'
                            }`}
                            style={s.status === 'published'
                              ? { background: s.colour ?? '#64748b' }
                              : undefined}
                          >
                            {shortTime(s.start_time)}
                          </button>
                        ))}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right text-secondary">
                    {formatHours(sumHours(
                      [...row.days.values()].flat()
                        .filter((s) => s.status !== 'cancelled')
                        .map((s) => s.paid_hours)
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted">
        A solid block is published; a dashed outline is still being planned and nobody has been
        told about it. Clicking a shift cancels it — a published shift cannot be retimed,
        because people have arranged their lives around it.
      </p>
    </div>
  );
};

export default HRRosterPage;
