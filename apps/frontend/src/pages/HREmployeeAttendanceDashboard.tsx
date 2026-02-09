/**
 * HR Employee Attendance Dashboard
 * 
 * Corporate workflow:
 * 1. HR views all employees' attendance status
 * 2. HR can approve/reject attendance records
 * 3. Support for multiple office locations
 * 4. Field officer location tracking
 * 5. Real-time attendance summary by location
 */

import React, { useEffect, useState } from 'react';
import { useToastStore } from '../components/Toast';
import { HIERARCHY } from '../utils/visualHierarchy';

interface EmployeeAttendance {
  id: string;
  name: string;
  email: string;
  department: string;
  location: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LOCATIONS_TRACKING';
  markedAt?: string;
  verificationMethod: 'FACE_RECOGNITION' | 'QR_CODE' | 'MOBILE_LOCATION' | 'MANUAL' | null;
  confidence?: number;
  location_data?: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  };
  notes?: string;
}

interface LocationSummary {
  location: string;
  present: number;
  absent: number;
  tracking: number;
  total: number;
}

type ViewMode = 'grid' | 'list' | 'locations' | 'field-tracking';
type FilterOption = 'is_all' | 'present' | 'absent' | 'late' | 'tracking' | 'by-location';

export const HREmployeeAttendanceDashboard: React.FC = () => {
  const addToast = useToastStore((state) => state.addToast);

  // State
  const [employees, setEmployees] = useState<EmployeeAttendance[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<EmployeeAttendance[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterMode, setFilterMode] = useState<FilterOption>('is_all');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAttendance | null>(null);
  const [showApprovalPanel, setShowApprovalPanel] = useState(false);

  // Simulate loading employees
  useEffect(() => {
    setIsLoading(true);
    // In real app: fetch from API
    setTimeout(() => {
      const mockEmployees: EmployeeAttendance[] = [
        {
          id: 'emp001',
          name: 'Aisha Patel',
          email: 'aisha.patel@company.com',
          department: 'Sales',
          location: 'New York Office',
          status: 'PRESENT',
          markedAt: new Date().toISOString(),
          verificationMethod: 'FACE_RECOGNITION',
          confidence: 92,
        },
        {
          id: 'emp002',
          name: 'James Chen',
          email: 'james.chen@company.com',
          department: 'Engineering',
          location: 'San Francisco Office',
          status: 'PRESENT',
          markedAt: new Date().toISOString(),
          verificationMethod: 'QR_CODE',
        },
        {
          id: 'emp003',
          name: 'Maria Rodriguez',
          email: 'maria.r@company.com',
          department: 'Field Sales',
          location: 'Remote',
          status: 'LOCATIONS_TRACKING',
          verificationMethod: 'MOBILE_LOCATION',
          location_data: {
            lat: 34.0522,
            lng: -118.2437,
            accuracy: 15,
            timestamp: new Date().toISOString(),
          },
        },
        {
          id: 'emp004',
          name: 'David Kim',
          email: 'david.kim@company.com',
          department: 'Engineering',
          location: 'San Francisco Office',
          status: 'ABSENT',
          verificationMethod: null,
        },
        {
          id: 'emp005',
          name: 'Sarah Johnson',
          email: 'sarah.j@company.com',
          department: 'HR',
          location: 'New York Office',
          status: 'LATE',
          markedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          verificationMethod: 'FACE_RECOGNITION',
          confidence: 88,
        },
        {
          id: 'emp006',
          name: 'Priya Sharma',
          email: 'priya.sharma@company.com',
          department: 'Field Sales',
          location: 'Remote',
          status: 'LOCATIONS_TRACKING',
          verificationMethod: 'MOBILE_LOCATION',
          location_data: {
            lat: 40.7128,
            lng: -74.006,
            accuracy: 25,
            timestamp: new Date().toISOString(),
          },
        },
      ];

      setEmployees(mockEmployees);
      setFilteredEmployees(mockEmployees);
      setIsLoading(false);
    }, 500);
  }, []);

  // Apply filters
  useEffect(() => {
    let filtered = [...employees];

    // Status filter
    switch (filterMode) {
      case 'present':
        filtered = filtered.filter((e) => e.status === 'PRESENT');
        break;
      case 'absent':
        filtered = filtered.filter((e) => e.status === 'ABSENT');
        break;
      case 'late':
        filtered = filtered.filter((e) => e.status === 'LATE');
        break;
      case 'tracking':
        filtered = filtered.filter((e) => e.status === 'LOCATIONS_TRACKING');
        break;
    }

    // Location filter
    if (selectedLocation !== 'all') {
      filtered = filtered.filter((e) => e.location === selectedLocation);
    }

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredEmployees(filtered);
  }, [filterMode, selectedLocation, searchQuery, employees]);

  // Calculate location summary
  const locationSummary: LocationSummary[] = [
    ...new Set(employees.map((e) => e.location)),
  ].map((loc) => {
    const forLocation = employees.filter((e) => e.location === loc);
    return {
      location: loc,
      present: forLocation.filter((e) => e.status === 'PRESENT').length,
      absent: forLocation.filter((e) => e.status === 'ABSENT').length,
      tracking: forLocation.filter((e) => e.status === 'LOCATIONS_TRACKING').length,
      total: forLocation.length,
    };
  });

  // Calculate stats
  const stats = {
    total: employees.length,
    present: employees.filter((e) => e.status === 'PRESENT').length,
    absent: employees.filter((e) => e.status === 'ABSENT').length,
    late: employees.filter((e) => e.status === 'LATE').length,
    tracking: employees.filter((e) => e.status === 'LOCATIONS_TRACKING').length,
  };

  const handleApproveAttendance = (employee: EmployeeAttendance) => {
    addToast({ type: 'success', title: 'Approved', message: `${employee.name}'s attendance approved` });
    setShowApprovalPanel(false);
    setSelectedEmployee(null);
  };

  const handleRejectAttendance = (employee: EmployeeAttendance, reason: string) => {
    addToast({ type: 'error', title: 'Rejected', message: `${employee.name}'s attendance rejected: ${reason}` });
    setShowApprovalPanel(false);
    setSelectedEmployee(null);
  };

  // ============ RENDER: STATS HEADER ============
  const renderStatsHeader = () => (
    <div className="grid gap-4 md:grid-cols-5 mb-8">
      <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
        <div className="text-sm text-slate-400">Total</div>
        <div className="text-2xl font-bold text-white mt-1">{stats.total}</div>
      </div>
      <div className="bg-slate-800 p-4 rounded-lg border border-green-700">
        <div className="text-sm text-green-400">Present</div>
        <div className="text-2xl font-bold text-green-400 mt-1">{stats.present}</div>
      </div>
      <div className="bg-slate-800 p-4 rounded-lg border border-red-700">
        <div className="text-sm text-red-400">Absent</div>
        <div className="text-2xl font-bold text-red-400 mt-1">{stats.absent}</div>
      </div>
      <div className="bg-slate-800 p-4 rounded-lg border border-amber-700">
        <div className="text-sm text-amber-400">Late</div>
        <div className="text-2xl font-bold text-amber-400 mt-1">{stats.late}</div>
      </div>
      <div className="bg-slate-800 p-4 rounded-lg border border-blue-700">
        <div className="text-sm text-blue-400">Tracking</div>
        <div className="text-2xl font-bold text-blue-400 mt-1">{stats.tracking}</div>
      </div>
    </div>
  );

  // ============ RENDER: EMPLOYEE GRID ============
  const renderEmployeeGrid = () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {filteredEmployees.map((emp) => (
        <div
          key={emp.id}
          onClick={() => {
            setSelectedEmployee(emp);
            setShowApprovalPanel(true);
          }}
          className="bg-slate-800 p-4 rounded-lg border border-slate-700 hover:border-blue-500 cursor-pointer transition-all hover:shadow-lg"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h4 className="font-semibold text-slate-200">{emp.name}</h4>
              <p className="text-xs text-slate-500">{emp.email}</p>
            </div>
            <div>
              {emp.status === 'PRESENT' && (
                <span className="inline-block px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                  ✅ Present
                </span>
              )}
              {emp.status === 'ABSENT' && (
                <span className="inline-block px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                  ❌ Absent
                </span>
              )}
              {emp.status === 'LATE' && (
                <span className="inline-block px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded">
                  ⏰ Late
                </span>
              )}
              {emp.status === 'LOCATIONS_TRACKING' && (
                <span className="inline-block px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                  📍 Tracking
                </span>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <div>📍 {emp.location}</div>
            <div>🏢 {emp.department}</div>
            {emp.markedAt && (
              <div>
                ⏱️{' '}
                {new Date(emp.markedAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            {emp.confidence && (
              <div className="text-blue-400 font-medium">🔐 {emp.confidence}% confidence</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  // ============ RENDER: EMPLOYEE LIST ============
  const renderEmployeeList = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-700 border-b border-slate-600">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Name</th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Department</th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Location</th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Status</th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Method</th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {filteredEmployees.map((emp) => (
            <tr
              key={emp.id}
              onClick={() => {
                setSelectedEmployee(emp);
                setShowApprovalPanel(true);
              }}
              className="hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 text-sm text-slate-300">
                <div className="font-medium">{emp.name}</div>
                <div className="text-xs text-slate-500">{emp.email}</div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-400">{emp.department}</td>
              <td className="px-4 py-3 text-sm text-slate-400">{emp.location}</td>
              <td className="px-4 py-3 text-center">
                {emp.status === 'PRESENT' && (
                  <span className="inline-block px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                    Present
                  </span>
                )}
                {emp.status === 'ABSENT' && (
                  <span className="inline-block px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                    Absent
                  </span>
                )}
                {emp.status === 'LATE' && (
                  <span className="inline-block px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded">
                    Late
                  </span>
                )}
                {emp.status === 'LOCATIONS_TRACKING' && (
                  <span className="inline-block px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                    Tracking
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-center text-xs text-slate-400">
                {emp.verificationMethod || '—'}
              </td>
              <td className="px-4 py-3 text-center text-xs text-slate-400">
                {emp.markedAt
                  ? new Date(emp.markedAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ============ RENDER: LOCATIONS VIEW ============
  const renderLocationsView = () => (
    <div className="grid gap-6 md:grid-cols-2">
      {locationSummary.map((loc) => (
        <div
          key={loc.location}
          className="bg-slate-800 p-6 rounded-lg border border-slate-700"
        >
          <h3 className="font-semibold text-slate-200 text-lg mb-4">📍 {loc.location}</h3>

          <div className="space-y-3 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-400">Present</span>
              <span className="text-lg font-bold text-green-400">{loc.present}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-400">Absent</span>
              <span className="text-lg font-bold text-red-400">{loc.absent}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-400">Tracking</span>
              <span className="text-lg font-bold text-blue-400">{loc.tracking}</span>
            </div>
          </div>

          <div className="bg-slate-700/50 p-3 rounded">
            <div className="text-xs text-slate-400">Attendance Rate</div>
            <div className="mt-2 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-green-500"
                style={{ width: `${(loc.present / loc.total) * 100}%` }}
              />
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {((loc.present / loc.total) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // ============ RENDER: FIELD TRACKING VIEW ============
  const renderFieldTrackingView = () => {
    const fieldEmployees = employees.filter((e) => e.status === 'LOCATIONS_TRACKING');

    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="font-semibold text-slate-200 text-lg mb-6">🗺️ Field Officer Locations</h3>

        <div className="bg-slate-900 rounded-lg h-96 mb-6 flex items-center justify-center border-2 border-dashed border-slate-600">
          <div className="text-center">
            <div className="text-4xl mb-3">🗺️</div>
            <p className="text-slate-400">Map view would render here</p>
            <p className="text-xs text-slate-500 mt-2">
              {fieldEmployees.length} field officers currently being tracked
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {fieldEmployees.map((emp) => (
            <div
              key={emp.id}
              className="p-4 bg-slate-700/50 rounded-lg flex items-center justify-between hover:bg-slate-700 transition-colors"
            >
              <div>
                <div className="font-medium text-slate-200">{emp.name}</div>
                <div className="text-xs text-slate-500">
                  📍 {emp.location_data?.lat.toFixed(4)}, {emp.location_data?.lng.toFixed(4)}
                </div>
                <div className="text-xs text-slate-500">
                  Accuracy: ±{emp.location_data?.accuracy}m
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-blue-400 font-medium">🔴 Live Tracking</div>
                <div className="text-xs text-slate-500 mt-1">
                  Updated{' '}
                  {new Date(emp.location_data?.timestamp || '').toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ============ RENDER: APPROVAL PANEL ============
  const renderApprovalPanel = () => {
    if (!selectedEmployee || !showApprovalPanel) return null;

    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg border border-slate-600 max-w-lg w-full p-6">
          <h3 className="text-xl font-semibold text-white mb-4">👤 Review Attendance</h3>

          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Employee Name</label>
              <div className="text-slate-200 font-medium">{selectedEmployee.name}</div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Status</label>
              <div className="text-slate-200">
                {selectedEmployee.status === 'PRESENT' && '✅ Present'}
                {selectedEmployee.status === 'ABSENT' && '❌ Absent'}
                {selectedEmployee.status === 'LATE' && '⏰ Late'}
                {selectedEmployee.status === 'LOCATIONS_TRACKING' && '📍 Tracking'}
              </div>
            </div>

            {selectedEmployee.confidence && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">Face Confidence</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${selectedEmployee.confidence}%` }}
                    />
                  </div>
                  <div className="text-sm font-medium text-blue-400">
                    {selectedEmployee.confidence}%
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-400 block mb-1">Verification Method</label>
              <div className="text-slate-200">{selectedEmployee.verificationMethod}</div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Location</label>
              <div className="text-slate-200">{selectedEmployee.location}</div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Department</label>
              <div className="text-slate-200">{selectedEmployee.department}</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                handleRejectAttendance(selectedEmployee, 'Manual rejection by HR');
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-all"
            >
              ❌ Reject
            </button>
            <button
              onClick={() => setShowApprovalPanel(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-all flex-1"
            >
              Cancel
            </button>
            <button
              onClick={() => handleApproveAttendance(selectedEmployee)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-all flex-1"
            >
              ✅ Approve
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ MAIN RENDER ============
  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className={HIERARCHY.PRIMARY.className}>👥 Employee Attendance Management</h1>
          <p className={HIERARCHY.SECONDARY.className}>
            Monitor and manage attendance across all offices and locations
          </p>
        </div>

        {/* Stats Header */}
        {renderStatsHeader()}

        {/* Controls */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Search */}
          <div className="flex-1 md:max-w-xs">
            <input
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Filter & View Controls */}
          <div className="flex gap-3 flex-wrap">
            {/* Status Filter */}
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterOption)}
              className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="is_all">All Status</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="tracking">Tracking</option>
            </select>

            {/* Location Filter */}
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Locations</option>
              {[...new Set(employees.map((e) => e.location))].map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>

            {/* View Mode */}
            <div className="flex gap-2 bg-slate-800 p-1 rounded-lg border border-slate-600">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('locations')}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  viewMode === 'locations'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Locations
              </button>
              <button
                onClick={() => setViewMode('field-tracking')}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  viewMode === 'field-tracking'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tracking
              </button>
            </div>
          </div>
        </div>

        {/* Content by View Mode */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-400">
            <p>Loading attendance data...</p>
          </div>
        ) : (
          <>
            {viewMode === 'grid' && renderEmployeeGrid()}
            {viewMode === 'list' && renderEmployeeList()}
            {viewMode === 'locations' && renderLocationsView()}
            {viewMode === 'field-tracking' && renderFieldTrackingView()}
          </>
        )}

        {/* Approval Panel */}
        {renderApprovalPanel()}
      </div>
    </div>
  );
};

export default HREmployeeAttendanceDashboard;
