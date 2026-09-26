/**
 * The platform operator's overview: tenants, people and open incidents.
 *
 * Every figure is one the server counts (GET /api/superadmin/stats). The page
 * used to read field names the endpoint never returned — so it showed zero
 * tenants and "undefined" users — and decorated each card with a fixed
 * "+12% this month" that no data stood behind. A trend is shown only when
 * there is a measurement to show; there is none yet, so there is none here.
 */
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, GraduationCap, Briefcase, Users } from 'lucide-react'
import { ErrorState, LoadingState } from '../components/states/PageStates'
import { apiClient } from '../services/api'

interface PlatformStats {
  tenants_total: number
  tenants_active: number
  tenants_suspended: number
  tenants_archived: number
  schools: number
  companies: number
  users_total: number
  users_active: number
  users_locked: number
  students: number
  employees: number
  incidents_open: number
}

const Kpi: React.FC<{
  title: string
  value: number
  detail: string
  icon: React.ElementType
  to?: string
  tone?: 'neutral' | 'warning'
}> = ({ title, value, detail, icon: Icon, to, tone = 'neutral' }) => {
  const body = (
    <div className="card h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-secondary">{title}</p>
          <p className={`text-3xl font-semibold mt-1 tabular-nums ${tone === 'warning' && value > 0 ? 'text-accent-800 dark:text-accent-300' : 'text-primary'}`}>
            {value.toLocaleString()}
          </p>
        </div>
        <Icon className="w-6 h-6 text-muted" aria-hidden />
      </div>
      <p className="text-xs text-muted mt-2">{detail}</p>
    </div>
  )
  return to ? <Link to={to} className="block hover:opacity-90">{body}</Link> : body
}

/** A proportion as a labelled bar; nothing to chart is said plainly. */
const Split: React.FC<{ title: string; parts: Array<{ label: string; value: number; cls: string }> }> = ({ title, parts }) => {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <section className="card space-y-3">
      <h2 className="font-medium text-primary">{title}</h2>
      {total === 0 ? (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken" role="img"
            aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
            {parts.map((p) => p.value > 0 && (
              <div key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${p.cls}`} aria-hidden />
                <span className="text-secondary">{p.label}</span>
                <span className="font-medium text-primary tabular-nums">{p.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const SuperadminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const response = await apiClient.get('/superadmin/stats')
      setStats(response.data.stats)
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'The platform figures could not be loaded')
    }
  }

  useEffect(() => { void load() }, [])

  if (error) {
    return <div className="p-4 sm:p-6"><ErrorState title="Dashboard unavailable" description={error} onRetry={() => void load()} /></div>
  }
  if (!stats) return <div className="p-4 sm:p-6"><LoadingState label="Loading platform figures…" /></div>

  const inactiveTenants = stats.tenants_suspended + stats.tenants_archived

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Platform overview</h1>
        <p className="text-sm text-secondary mt-1">Every school and company on the platform, and the people in them.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Tenants" value={stats.tenants_total} icon={Building2} to="/superadmin/management"
          detail={`${stats.schools} school${stats.schools === 1 ? '' : 's'}, ${stats.companies} compan${stats.companies === 1 ? 'y' : 'ies'}`} />
        <Kpi title="Active tenants" value={stats.tenants_active} icon={Building2} to="/superadmin/management"
          detail={inactiveTenants ? `${stats.tenants_suspended} suspended, ${stats.tenants_archived} archived` : 'None suspended or archived'} />
        <Kpi title="Users" value={stats.users_total} icon={Users}
          detail={`${stats.users_active} active, ${stats.users_locked} deactivated`} />
        <Kpi title="Open incidents" value={stats.incidents_open} icon={AlertTriangle} to="/superadmin/incidents"
          tone="warning" detail={stats.incidents_open ? 'Not yet resolved' : 'Nothing open'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Split title="Tenants by platform" parts={[
          { label: 'Schools (SMS)', value: stats.schools, cls: 'bg-brand-500' },
          { label: 'Companies (EMS)', value: stats.companies, cls: 'bg-accent-500' },
        ]} />
        <Split title="Tenants by status" parts={[
          { label: 'Active', value: stats.tenants_active, cls: 'bg-success-500' },
          { label: 'Suspended', value: stats.tenants_suspended, cls: 'bg-accent-500' },
          { label: 'Archived', value: stats.tenants_archived, cls: 'bg-slate-400' },
        ]} />
        <Split title="People" parts={[
          { label: 'Students', value: stats.students, cls: 'bg-brand-500' },
          { label: 'Employees', value: stats.employees, cls: 'bg-accent-500' },
        ]} />
        <Split title="Accounts" parts={[
          { label: 'Active', value: stats.users_active, cls: 'bg-success-500' },
          { label: 'Deactivated', value: stats.users_locked, cls: 'bg-slate-400' },
        ]} />
      </div>

      <p className="text-xs text-muted flex items-center gap-1">
        <GraduationCap className="w-3 h-3" aria-hidden /><Briefcase className="w-3 h-3" aria-hidden />
        Counts are live. Trends will appear here once the platform records them over time.
      </p>
    </div>
  )
}

export default SuperadminDashboardPage
