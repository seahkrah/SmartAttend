import React from 'react';
import { BarChart3, Users, Clock, TrendingUp, AlertCircle } from 'lucide-react';
import { Sidebar, Topbar } from '../components/Navigation';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { dashboardService, DashboardStats } from '../services/dashboard';

export const DashboardPage: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  React.useEffect(() => {
    const loadDashboardData = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        const data = await dashboardService.getDashboardStats(user.id);
        setStats(data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load dashboard data');
        console.error('Dashboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user) {
    navigate('/login');
    return null;
  }

  const statsDisplay = [
    {
      title: 'Total Attendance',
      value: `${stats?.totalAttendance ?? 94}%`,
      change: '+2.5%',
      icon: BarChart3,
      color: 'from-primary-500 to-primary-600',
    },
    {
      title: 'Present Days',
      value: `${stats?.presentDays ?? 47}`,
      change: '+1 from last week',
      icon: Clock,
      color: 'from-secondary-500 to-secondary-600',
    },
    {
      title: 'Total Members',
      value: `${stats?.totalMembers ?? 324}`,
      change: '+12 new members',
      icon: Users,
      color: 'from-accent-500 to-accent-600',
    },
    {
      title: 'Trend',
      value: stats?.trend === 'up' ? 'Up' : stats?.trend === 'down' ? 'Down' : 'Stable',
      change: 'Performance improving',
      icon: TrendingUp,
      color: 'from-emerald-500 to-emerald-600',
    },
  ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 lg:ml-64">
        {/* Topbar */}
        <Topbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} userName={user.fullName} />

        {/* Content */}
        <main className="mt-16 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Welcome, {user.fullName}!</h1>
              <p className="text-slate-400">Here's your attendance overview for {user.platform}</p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-red-300 font-semibold">Error Loading Data</h3>
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-40 bg-slate-800/50 rounded-lg animate-pulse"></div>
                ))}
              </div>
            )}

            {/* Stats Grid */}
            {!loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statsDisplay.map((stat, index) => {
                  const Icon = stat.icon;
                  return (
                    <div key={index} className="card hover:shadow-glow">
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-lg flex items-center justify-center`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-xs font-medium text-accent-400">{stat.change}</span>
                      </div>
                      <p className="text-slate-400 text-sm mb-1">{stat.title}</p>
                      <p className="text-3xl font-bold text-white">{stat.value}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart Area */}
              <div className="lg:col-span-2 card">
                <h2 className="text-xl font-bold text-white mb-6">Attendance Trends</h2>
                <div className="h-64 flex items-center justify-center text-slate-500">
                  <p>Chart placeholder - API integration in progress</p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-6">Quick Actions</h2>
                <div className="space-y-3">
                  <button className="btn-primary w-full justify-center">Mark Attendance</button>
                  <button className="btn-secondary w-full justify-center">View Reports</button>
                  <button className="btn-outline w-full justify-center">Settings</button>
                </div>

                {/* Platform Badge */}
                <div className="mt-6 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                  <p className="text-xs text-slate-400 mb-2">Current Platform</p>
                  <div className="badge">
                    <span className="capitalize">{user.platform}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
