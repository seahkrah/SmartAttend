/**
 * The school's attendance at a glance: one day by class, and one term by
 * student and by class (src/reports/schoolAttendance.ts on the API, which
 * says what each number means). Each downloads as CSV from the API, so the
 * file and the screen are the same numbers.
 */
import React, { useEffect, useState } from 'react';
import { axiosClient } from '../../utils/axiosClient';

const BASE = '/auth/admin/school/reports/attendance';

interface DailyClass {
  scheduleId: string; courseCode: string; courseName: string; section: number | null; startTime: string | null;
  faculty: string | null; meetsToday: boolean; enrolled: number; present: number; late: number; absent: number;
  excused: number; unmarked: number; byFace: number; byHand: number; registerTaken: boolean;
}
interface Daily {
  date: string;
  totals: { classes: number; registersTaken: number; registersNotTaken: number; enrolled: number; present: number; late: number;
    absent: number; excused: number; unmarked: number; byFace: number; byHand: number };
  classes: DailyClass[];
}
interface TermStudent {
  studentId: string; studentNumber: string; name: string; sessions: number; present: number; late: number; absent: number;
  excused: number; unmarked: number; ratePercent: number | null; below: boolean;
}
interface Term {
  term: { id: string; name: string; startDate: string; endDate: string };
  atRiskPercent: number;
  totals: { students: number; below: number; sessions: number };
  students: TermStudent[];
  classes: { scheduleId: string; courseCode: string; courseName: string; section: number | null; faculty: string | null;
    sessions: number; students: number; ratePercent: number | null }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const errorOf = (e: any, fallback: string) => e?.response?.data?.error ?? fallback;
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const th = 'px-3 py-2 text-left text-xs font-medium text-muted uppercase';
const td = 'px-3 py-2 text-sm text-primary tabular-nums';

async function download(url: string, params: Record<string, string>, name: string) {
  const res = await axiosClient.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const href = window.URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  window.URL.revokeObjectURL(href);
}

const SchoolAttendanceSummaries: React.FC = () => {
  const [date, setDate] = useState(today());
  const [daily, setDaily] = useState<Daily | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [terms, setTerms] = useState<{ id: string; name: string }[]>([]);
  const [termId, setTermId] = useState('');
  const [term, setTerm] = useState<Term | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axiosClient.get('/academics/terms').then((r) => {
      const list = (r.data.terms ?? []).map((t: any) => ({ id: t.id, name: t.name }));
      setTerms(list);
      if (list.length) setTermId(list[0].id);
    }).catch(() => setTerms([]));
  }, []);

  useEffect(() => {
    setDailyError(null);
    axiosClient.get(`${BASE}/daily`, { params: { date } })
      .then((r) => setDaily(r.data))
      .catch((e) => { setDaily(null); setDailyError(errorOf(e, 'The day could not be loaded')); });
  }, [date]);

  useEffect(() => {
    if (!termId) return;
    setTermError(null);
    axiosClient.get(`${BASE}/term/${termId}`)
      .then((r) => setTerm(r.data))
      .catch((e) => { setTerm(null); setTermError(errorOf(e, 'The term could not be loaded')); });
  }, [termId]);

  const save = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { setTermError(errorOf(e, 'The file could not be made')); } finally { setBusy(false); }
  };

  const students = term ? (onlyBelow ? term.students.filter((s) => s.below) : term.students) : [];

  return (
    <div className="space-y-6 mb-6">
      <section className="bg-card rounded-lg shadow p-6 space-y-3" aria-labelledby="rep-day">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rep-day" className="font-semibold text-lg text-primary">The day by class</h2>
            <p className="text-xs text-muted">Classes that meet on the day, and any class marked on it. A register not taken is shown, not hidden.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="block text-secondary mb-1">Date</span>
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
                className="px-3 py-2 border border-subtle rounded-lg bg-card text-primary" />
            </label>
            <button className="px-4 py-2 rounded-lg border border-subtle text-primary hover:bg-sunken disabled:opacity-50" disabled={busy || !daily}
              onClick={() => void save(() => download(`${BASE}/daily`, { date }, `attendance-${date}.csv`))}>Download CSV</button>
          </div>
        </div>
        {dailyError && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{dailyError}</p>}
        {daily && (
          <>
            <p className="text-sm text-secondary">
              {daily.totals.classes} classes · {daily.totals.registersTaken} registers taken
              {daily.totals.registersNotTaken > 0 && <span className="text-amber-700 dark:text-amber-300"> · {daily.totals.registersNotTaken} not taken</span>}
              {' '}· {daily.totals.present} present, {daily.totals.late} late, {daily.totals.absent} absent, {daily.totals.excused} excused,
              {' '}{daily.totals.unmarked} unmarked · {daily.totals.byFace} by face, {daily.totals.byHand} by hand
            </p>
            {daily.classes.length === 0 ? <p className="text-sm text-muted">No classes on this day.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-subtle">
                  <thead><tr>{['Class', 'Time', 'Teacher', 'Enrolled', 'Present', 'Late', 'Absent', 'Excused', 'Unmarked', 'Register'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-subtle">
                    {daily.classes.map((c) => (
                      <tr key={c.scheduleId}>
                        <td className={td}>{c.courseCode}{c.section ? ` §${c.section}` : ''}<span className="block text-xs text-muted">{c.courseName}</span></td>
                        <td className={td}>{c.startTime ?? ''}</td>
                        <td className={td}>{c.faculty ?? ''}</td>
                        <td className={td}>{c.enrolled}</td>
                        <td className={td}>{c.present}</td>
                        <td className={td}>{c.late}</td>
                        <td className={td}>{c.absent}</td>
                        <td className={td}>{c.excused}</td>
                        <td className={td}>{c.unmarked}</td>
                        <td className={td}>{c.registerTaken ? 'Taken' : <span className="text-amber-700 dark:text-amber-300">{c.meetsToday ? 'Not taken' : 'No class'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="bg-card rounded-lg shadow p-6 space-y-3" aria-labelledby="rep-term">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rep-term" className="font-semibold text-lg text-primary">The term</h2>
            <p className="text-xs text-muted">
              Rate = present and late over sessions held, excused left out. A session with no mark for an enrolled student counts as not attended.
              {term && ` Below ${term.atRiskPercent}% is the school's line for following up.`}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="block text-secondary mb-1">Term</span>
              <select value={termId} onChange={(e) => setTermId(e.target.value)} className="px-3 py-2 border border-subtle rounded-lg bg-card text-primary">
                {terms.length === 0 && <option value="">No terms</option>}
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <button className="px-4 py-2 rounded-lg border border-subtle text-primary hover:bg-sunken disabled:opacity-50" disabled={busy || !term}
              onClick={() => void save(() => download(`${BASE}/term/${termId}`, {}, 'term-attendance.csv'))}>Download CSV</button>
          </div>
        </div>
        {termError && <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">{termError}</p>}
        {term && (
          <>
            <p className="text-sm text-secondary">
              {term.term.startDate} to {term.term.endDate} · {term.totals.sessions} sessions · {term.totals.students} students ·
              <span className={term.totals.below ? ' text-amber-700 dark:text-amber-300' : ''}> {term.totals.below} below {term.atRiskPercent}%</span>
            </p>
            <label className="text-sm text-secondary flex items-center gap-2">
              <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} /> Only students below the line
            </label>
            {students.length === 0 ? <p className="text-sm text-muted">{term.students.length ? 'Nobody is below the line.' : 'No registers taken in this term yet.'}</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-subtle">
                  <thead><tr>{['Student', 'Sessions', 'Present', 'Late', 'Absent', 'Excused', 'Unmarked', 'Rate'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-subtle">
                    {students.map((s) => (
                      <tr key={s.studentId}>
                        <td className={td}>{s.name}<span className="block text-xs text-muted">{s.studentNumber}</span></td>
                        <td className={td}>{s.sessions}</td>
                        <td className={td}>{s.present}</td>
                        <td className={td}>{s.late}</td>
                        <td className={td}>{s.absent}</td>
                        <td className={td}>{s.excused}</td>
                        <td className={td}>{s.unmarked}</td>
                        <td className={`${td} ${s.below ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>{pct(s.ratePercent)}{s.below ? ' · below' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {term.classes.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-subtle">
                  <thead><tr>{['Class', 'Teacher', 'Sessions', 'Students', 'Rate'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-subtle">
                    {term.classes.map((c) => (
                      <tr key={c.scheduleId}>
                        <td className={td}>{c.courseCode}{c.section ? ` §${c.section}` : ''}<span className="block text-xs text-muted">{c.courseName}</span></td>
                        <td className={td}>{c.faculty ?? ''}</td>
                        <td className={td}>{c.sessions}</td>
                        <td className={td}>{c.students}</td>
                        <td className={td}>{pct(c.ratePercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default SchoolAttendanceSummaries;
