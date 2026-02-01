import React from 'react';
import { Menu, X, LogOut, User, Home, BarChart3, Users, Settings } from 'lucide-react';
import { SmartAttendLogo } from './BrandLogo';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onLogout }) => {
  const menuItems = [
    { icon: Home, label: 'Dashboard', href: '#' },
    { icon: Users, label: 'Attendance', href: '#' },
    { icon: BarChart3, label: 'Reports', href: '#' },
    { icon: User, label: 'Profile', href: '#' },
    { icon: Settings, label: 'Settings', href: '#' },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm lg:hidden z-40" onClick={onClose}></div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-slate-900/95 border-r border-slate-700/50 backdrop-blur-xl transform transition-transform duration-300 lg:translate-x-0 z-50 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-700/30">
          <div className="flex items-center justify-between">
            <SmartAttendLogo size="md" showText={true} />
            <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Menu Items */}
        <nav className="p-4 space-y-2">
          {menuItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-primary-500/20 transition-all duration-300 group"
            >
              <item.icon className="w-5 h-5 group-hover:text-primary-400 transition-colors" />
              <span className="font-medium">{item.label}</span>
            </a>
          ))}
        </nav>

        {/* Logout Button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-700/30">
          <button
            onClick={onLogout}
            className="btn-secondary w-full justify-center inline-flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
};

interface TopbarProps {
  onMenuClick: () => void;
  userName: string;
}

export const Topbar: React.FC<TopbarProps> = ({ onMenuClick, userName }) => {
  return (
    <div className="fixed top-0 left-0 right-0 h-16 bg-slate-900/95 border-b border-slate-700/50 backdrop-blur-xl z-40 flex items-center justify-between px-6">
      <button onClick={onMenuClick} className="lg:hidden text-slate-300 hover:text-white">
        <Menu className="w-6 h-6" />
      </button>

      <div className="flex-1 flex justify-center">
        <div className="hidden md:flex items-center gap-2">
          <SmartAttendLogo size="md" showText={true} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-slate-300">{userName}</span>
        </div>
      </div>
    </div>
  );
};
