/**
 * Where, from what and when employees may check in (brief 5.5).
 *
 * Four controls, each off, flag (recorded, held for a manager, alerted) or
 * enforce (refused); the sites that make up the geofence and the networks
 * check-ins may come from; and the devices registered for check-in. The admin
 * and the HR director change these; HR sees them. The API decides; this page
 * only says what it will decide.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, Smartphone, ShieldCheck, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/states/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState, NoAccessState } from '../components/states/PageStates';
import { axiosClient } from '../utils/axiosClient';
import { deviceId } from '../utils/deviceId';

type Mode = 'off' | 'flag' | 'enforce';
interface Settings {
  geofence: Mode; network: Mode; device: Mode; shift_window: Mode;
  maxAccuracyMetres: number; shiftEarlyMinutes: number; shiftLateMinutes: number; buddySeconds: number; maxSpeedKmh: number;
}
interface Site { id: string; name: string; latitude: number; longitude: number; radiusMetres: number; allowedCidrs: string[]; isActive: boolean }
interface Device { id: string; deviceId: string; employeeId: string | null; employeeName: string | null; label: string | null; registeredAt: string }
interface Employee { id: string; name: string }

const CONTROLS: { key: keyof Settings; label: string; says: string }[] = [
  { key: 'geofence', label: 'At a site', says: 'The phone\'s reported position, allowing for its accuracy, is inside one of the sites below. A position can be faked on a tampered phone; this keeps honest people honest.' },
  { key: 'network', label: 'On a site\'s network', says: 'The check-in comes from one of the networks listed on the sites.' },
  { key: 'device', label: 'On a registered device', says: 'The device is registered to the employee, or is a shared kiosk.' },
  { key: 'shift_window', label: 'During a rostered shift', says: 'Someone rostered today checks in during their shift, from the minutes before it set below. Someone not rostered is not refused.' },
];
const MODE_LABEL: Record<Mode, string> = { off: 'Off', flag: 'Flag for a manager', enforce: 'Refuse' };

function apiError(e: any, fallback: string) {
  return e?.response?.data?.error ?? fallback;
}

const CheckinControlsPage: React.FC<{ canChange: boolean }> = ({ canChange }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteForm, setSiteForm] = useState({ name: '', latitude: '', longitude: '', radiusMetres: '150', cidrs: '' });
  const [deviceForm, setDeviceForm] = useState({ deviceId: '', employeeId: '', label: '' });
  const [retire, setRetire] = useState<Site | null>(null);
  const [revoke, setRevoke] = useState<Device | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, si, d] = await Promise.all([
        axiosClient.get('/checkin-controls/settings'),
        axiosClient.get('/checkin-controls/sites'),
        axiosClient.get('/checkin-controls/devices'),
      ]);
      setSettings(s.data.settings);
      setSites(si.data.sites);
      setDevices(d.data.devices);
      if (canChange) {
        const e = await axiosClient.get('/corporate/employees', { params: { limit: 200 } }).catch(() => null);
        const rows = e?.data?.data ?? [];
        setEmployees(rows.map((x: any) => ({ id: x.id, name: `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim() || x.employee_number })));
      }
    } catch (e: any) {
      if (e?.response?.status === 403) setForbidden(true);
      else setError(apiError(e, 'The check-in rules could not be loaded'));
    }
  }, [canChange]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: 'ok', text: ok });
      await load();
      return true;
    } catch (e) {
      setNotice({ tone: 'bad', text: apiError(e, 'That did not work') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) return <div className="p-6"><NoAccessState /></div>;
  if (error) return <div className="p-6"><ErrorState title="The check-in rules could not be loaded" description={error} onRetry={load} /></div>;
  if (!settings) return <div className="p-6"><LoadingState label="Loading the check-in rules" /></div>;

  const field = 'w-full rounded-lg border border-subtle bg-card px-3 py-2 text-sm text-primary placeholder:text-muted';
  const number = (key: keyof Settings, label: string, unit: string) => (
    <label className="text-sm">
      <span className="block text-secondary mb-1">{label}</span>
      <span className="flex items-center gap-2">
        <input type="number" className={`${field} w-28`} disabled={!canChange || busy} defaultValue={settings[key] as number}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== settings[key]) void act(() => axiosClient.put('/checkin-controls/settings', { [key]: v }), 'Saved');
          }} />
        <span className="text-muted">{unit}</span>
      </span>
    </label>
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary flex items-center gap-2"><ShieldCheck className="w-6 h-6" /> Check-in rules</h1>
        <p className="text-secondary mt-1 max-w-3xl text-sm">
          Where, from what and when employees may check in. "Flag" records the check-in but holds its hours until a
          manager approves them, and raises an alert; "Refuse" turns it away with the reason. Alerts for one phone
          checking in several people, and for check-ins too far apart to travel between, are raised whatever is set here.
        </p>
        {!canChange && <p className="text-sm text-muted mt-1">An administrator or the HR director can change these.</p>}
      </header>

      {notice && (
        <div role="status" className={`card text-sm ${notice.tone === 'ok' ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>
          {notice.text}
        </div>
      )}

      <section className="card space-y-4" aria-labelledby="cc-controls">
        <h2 id="cc-controls" className="font-semibold text-primary">Controls</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {CONTROLS.map((c) => (
            <div key={c.key} className="space-y-1">
              <label htmlFor={`cc-${c.key}`} className="font-medium text-primary text-sm">{c.label}</label>
              <p className="text-xs text-muted">{c.says}</p>
              <select id={`cc-${c.key}`} className={`${field} max-w-xs`} disabled={!canChange || busy} value={settings[c.key] as Mode}
                onChange={(e) => void act(() => axiosClient.put('/checkin-controls/settings', { [c.key]: e.target.value }), 'Saved')}>
                {(['off', 'flag', 'enforce'] as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {number('maxAccuracyMetres', 'Least precise position accepted', 'metres')}
          {number('shiftEarlyMinutes', 'Check in before a shift', 'minutes')}
          {number('shiftLateMinutes', 'Check in after a shift ends', 'minutes')}
          {number('buddySeconds', 'Two people on one phone within', 'seconds')}
          {number('maxSpeedKmh', 'Faster than this between check-ins is impossible', 'km/h')}
        </div>
      </section>

      <section className="card space-y-3" aria-labelledby="cc-sites">
        <h2 id="cc-sites" className="font-semibold text-primary flex items-center gap-2"><MapPin className="w-4 h-4" /> Sites ({sites.filter((s) => s.isActive).length})</h2>
        {sites.length === 0 ? <EmptyState title="No sites yet" description="With no site, the location and network rules have nothing to check against and let everyone in." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Site</th><th className="pr-3">Centre</th><th className="pr-3">Radius</th><th className="pr-3">Networks</th><th /></tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className={`border-t border-subtle ${s.isActive ? '' : 'opacity-50'}`}>
                    <td className="py-2 pr-3">{s.name}{!s.isActive && ' (retired)'}</td>
                    <td className="pr-3 tabular-nums">{s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}</td>
                    <td className="pr-3">{s.radiusMetres} m</td>
                    <td className="pr-3 font-mono text-xs">{s.allowedCidrs.join(', ') || <span className="text-muted">any</span>}</td>
                    <td className="text-right">{canChange && s.isActive && (
                      <button className="text-danger-600 dark:text-danger-400 inline-flex items-center gap-1" onClick={() => setRetire(s)} disabled={busy}>
                        <Trash2 className="w-4 h-4" /> Retire
                      </button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canChange && (
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 items-end" onSubmit={(e) => {
            e.preventDefault();
            void act(() => axiosClient.post('/checkin-controls/sites', {
              name: siteForm.name, latitude: Number(siteForm.latitude), longitude: Number(siteForm.longitude),
              radiusMetres: Number(siteForm.radiusMetres),
              allowedCidrs: siteForm.cidrs.split(/[\s,]+/).filter(Boolean),
            }), 'Site added').then((ok) => ok && setSiteForm({ name: '', latitude: '', longitude: '', radiusMetres: '150', cidrs: '' }));
          }}>
            <input aria-label="Site name" placeholder="Name" className={field} value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} />
            <input aria-label="Latitude" placeholder="Latitude" className={field} value={siteForm.latitude} onChange={(e) => setSiteForm({ ...siteForm, latitude: e.target.value })} />
            <input aria-label="Longitude" placeholder="Longitude" className={field} value={siteForm.longitude} onChange={(e) => setSiteForm({ ...siteForm, longitude: e.target.value })} />
            <input aria-label="Radius in metres" placeholder="Radius (m)" className={field} value={siteForm.radiusMetres} onChange={(e) => setSiteForm({ ...siteForm, radiusMetres: e.target.value })} />
            <input aria-label="Networks" placeholder="Networks, e.g. 203.0.113.0/24" className={field} value={siteForm.cidrs} onChange={(e) => setSiteForm({ ...siteForm, cidrs: e.target.value })} />
            <button type="submit" className="btn-primary" disabled={busy || !siteForm.name}>Add site</button>
          </form>
        )}
      </section>

      <section className="card space-y-3" aria-labelledby="cc-devices">
        <h2 id="cc-devices" className="font-semibold text-primary flex items-center gap-2"><Smartphone className="w-4 h-4" /> Registered devices ({devices.length})</h2>
        <p className="text-xs text-muted">
          A device is the browser it is used in: the employee opens the app on it and reads its id from their attendance page.
          This browser's id is <span className="font-mono">{deviceId()}</span>. Clearing the browser's data gives it a new one.
        </p>
        {devices.length === 0 ? <EmptyState title="No devices registered" description="Register an employee's phone, or a shared kiosk, here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Device</th><th className="pr-3">For</th><th className="pr-3">Label</th><th /></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-t border-subtle">
                    <td className="py-2 pr-3 font-mono text-xs break-all">{d.deviceId}</td>
                    <td className="pr-3">{d.employeeName ?? 'Shared kiosk'}</td>
                    <td className="pr-3">{d.label ?? ''}</td>
                    <td className="text-right">{canChange && (
                      <button className="text-danger-600 dark:text-danger-400 inline-flex items-center gap-1" onClick={() => setRevoke(d)} disabled={busy}>
                        <Trash2 className="w-4 h-4" /> Revoke
                      </button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canChange && (
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 items-end" onSubmit={(e) => {
            e.preventDefault();
            void act(() => axiosClient.post('/checkin-controls/devices', {
              deviceId: deviceForm.deviceId.trim(), employeeId: deviceForm.employeeId || null, label: deviceForm.label || null,
            }), 'Device registered').then((ok) => ok && setDeviceForm({ deviceId: '', employeeId: '', label: '' }));
          }}>
            <input aria-label="Device id" placeholder="Device id" className={field} value={deviceForm.deviceId} onChange={(e) => setDeviceForm({ ...deviceForm, deviceId: e.target.value })} />
            <select aria-label="Employee" className={field} value={deviceForm.employeeId} onChange={(e) => setDeviceForm({ ...deviceForm, employeeId: e.target.value })}>
              <option value="">Shared kiosk</option>
              {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input aria-label="Label" placeholder="Label, e.g. Lobby tablet" className={field} value={deviceForm.label} onChange={(e) => setDeviceForm({ ...deviceForm, label: e.target.value })} />
            <button type="submit" className="btn-primary" disabled={busy || deviceForm.deviceId.trim().length < 8}>Register</button>
          </form>
        )}
      </section>

      <ConfirmDialog
        open={!!retire}
        title={`Retire ${retire?.name ?? 'this site'}?`}
        consequence="Check-ins will no longer be placed at it. Past check-ins keep what was recorded."
        confirmLabel="Retire"
        onCancel={() => setRetire(null)}
        onConfirm={() => { const s = retire; setRetire(null); if (s) void act(() => axiosClient.delete(`/checkin-controls/sites/${s.id}`), 'Site retired'); }}
      />
      <ConfirmDialog
        open={!!revoke}
        title="Revoke this device?"
        consequence="If devices are required, nobody can check in on it until it is registered again."
        confirmLabel="Revoke"
        onCancel={() => setRevoke(null)}
        onConfirm={() => { const d = revoke; setRevoke(null); if (d) void act(() => axiosClient.delete(`/checkin-controls/devices/${d.id}`), 'Device revoked'); }}
      />
    </div>
  );
};

export default CheckinControlsPage;
