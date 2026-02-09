/**
 * Employee/Student Self-Service Attendance
 * 
 * Allow employees/students to:
 * 1. View active sessions they can join
 * 2. Mark attendance with face recognition
 * 3. See their attendance history
 * 4. Get clear feedback on successful marking
 */

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../components/Toast';
import { HIERARCHY } from '../utils/visualHierarchy';
import FaceCaptureComponent from '../components/FaceCaptureComponent';
import { type FaceCapture } from '../services/faceEncodingService';
import { verifyFaceWithBackend } from '../services/faceVerificationAPI';

interface ActiveSession {
  id: string;
  courseName: string;
  courseDepartment: string;
  startTime: string;
  endTime: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
  attendanceMethod: 'FACE_RECOGNITION' | 'QR_CODE' | 'BOTH';
  attendeeCount: number;
  totalCapacity: number;
}

interface AttendanceRecord {
  id: string;
  courseName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE';
  verificationMethod: 'FACE_RECOGNITION' | 'QR_CODE' | null;
  confidence?: number;
  markedAt?: string;
}

type PanelMode = 'available-sessions' | 'mark-attendance' | 'history' | 'success';

export const EmployeeSelfServiceAttendance: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const addToast = useToastStore((state) => state.addToast);

  // State
  const [mode, setMode] = useState<PanelMode>('available-sessions');
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastMarkedSession, setLastMarkedSession] = useState<ActiveSession | null>(null);
  const [faceConfidence, setFaceConfidence] = useState<number>(0);
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [isFaceProcessing, setIsFaceProcessing] = useState(false);

  // Load available sessions on mount
  useEffect(() => {
    setIsLoading(true);
    // In real app: fetch from API
    setTimeout(() => {
      const mockSessions: ActiveSession[] = [
        {
          id: 'sess001',
          courseName: 'Database Systems',
          courseDepartment: 'Computer Science',
          startTime: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          endTime: new Date(Date.now() + 60 * 60 * 1000).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          status: 'IN_PROGRESS',
          attendanceMethod: 'FACE_RECOGNITION',
          attendeeCount: 24,
          totalCapacity: 35,
        },
        {
          id: 'sess002',
          courseName: 'Web Development',
          courseDepartment: 'Computer Science',
          startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          endTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          status: 'OPEN',
          attendanceMethod: 'BOTH',
          attendeeCount: 0,
          totalCapacity: 30,
        },
      ];

      setSessions(mockSessions);

      // Load attendance history
      const mockHistory: AttendanceRecord[] = [
        {
          id: 'att001',
          courseName: 'Database Systems',
          date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '10:30',
          status: 'PRESENT',
          verificationMethod: 'FACE_RECOGNITION',
          confidence: 92,
          markedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'att002',
          courseName: 'Web Development',
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          startTime: '14:00',
          endTime: '15:30',
          status: 'PRESENT',
          verificationMethod: 'FACE_RECOGNITION',
          confidence: 88,
          markedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'att003',
          courseName: 'Database Systems',
          date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '10:30',
          status: 'ABSENT',
          verificationMethod: null,
        },
      ];

      setHistory(mockHistory);
      setIsLoading(false);
    }, 800);
  }, []);

  // Handle captured face for attendance
  const handleFaceCapture = async (face: FaceCapture) => {
    if (!selectedSession) return;

    try {
      setIsFaceProcessing(true);

      // Send to backend for verification
      // Generate a pseudo-sessionId for now (in real app, would be from activeSession)
      const pseudoSessionId = `session-${selectedSession.id}`;
      const result = await verifyFaceWithBackend({
        sessionId: pseudoSessionId,
        studentId: user?.id || 'unknown',
        embedding: face.embedding,
        imageMetadata: face.imageMetadata,
      });

      // Add to history
      const newRecord: AttendanceRecord = {
        id: `att${Date.now()}`,
        courseName: selectedSession.courseName,
        date: new Date().toISOString().split('T')[0],
        startTime: selectedSession.startTime,
        endTime: selectedSession.endTime,
        status: 'PRESENT',
        verificationMethod: 'FACE_RECOGNITION',
        confidence: result.confidence,
        markedAt: new Date().toISOString(),
      };

      setHistory((prev) => [newRecord, ...prev]);
      setLastMarkedSession(selectedSession);
      setFaceConfidence(result.confidence);
      setShowFaceCapture(false);
      setMode('success');

      addToast({
        type: result.verified ? 'success' : 'warning',
        title: result.verified ? '✅ Attendance Marked' : '⚠️ Low Confidence',
        message: `${result.confidence}% confidence`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Verification Failed',
        message: 'Face verification could not be completed',
      });
    } finally {
      setIsFaceProcessing(false);
    }
  };

  // Start face capture
  const handleMarkWithFace = async () => {
    if (!selectedSession) return;
    setShowFaceCapture(true);
  };

  // ============ RENDER: AVAILABLE SESSIONS ============
  const renderAvailableSessions = () => {
    return (
      <div className="space-y-4">
        <div className="grid gap-4">
          {sessions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg">📭 No active sessions</p>
              <p className="text-sm mt-1">Check back later or contact your instructor</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  setSelectedSession(session);
                  setMode('mark-attendance');
                }}
                className="p-6 bg-slate-800 border border-slate-700 rounded-lg hover:border-blue-500 hover:bg-slate-700/50 transition-all text-left"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white">{session.courseName}</h3>
                    <p className="text-sm text-slate-400 mt-1">{session.courseDepartment}</p>
                  </div>
                  <div>
                    {session.status === 'IN_PROGRESS' && (
                      <span className="inline-block px-3 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded">
                        🔴 In Progress
                      </span>
                    )}
                    {session.status === 'OPEN' && (
                      <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-medium rounded">
                        🟢 Opening Soon
                      </span>
                    )}
                    {session.status === 'CLOSED' && (
                      <span className="inline-block px-3 py-1 bg-slate-600 text-slate-400 text-xs font-medium rounded">
                        ⏹️ Closed
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-3 text-sm text-slate-400 mb-4">
                  <div>⏱️ {session.startTime} - {session.endTime}</div>
                  <div>👥 {session.attendeeCount}/{session.totalCapacity} marked</div>
                  <div>
                    🔐{' '}
                    {session.attendanceMethod === 'FACE_RECOGNITION' && 'Face Recognition'}
                    {session.attendanceMethod === 'QR_CODE' && 'QR Code'}
                    {session.attendanceMethod === 'BOTH' && 'Face or QR Code'}
                  </div>
                </div>

                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{
                      width: `${(session.attendeeCount / session.totalCapacity) * 100}%`,
                    }}
                  />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============ RENDER: MARK ATTENDANCE ============
  const renderMarkAttendance = () => {
    if (!selectedSession) return null;

    return (
      <div className="space-y-6">
        {/* Session Info */}
        <div className="bg-blue-900/30 border border-blue-500 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-white mb-2">{selectedSession.courseName}</h2>
          <p className="text-slate-400 mb-4">{selectedSession.courseDepartment}</p>
          <div className="grid gap-2 text-sm text-slate-300">
            <div>⏱️ {selectedSession.startTime} - {selectedSession.endTime}</div>
            <div>👥 {selectedSession.attendeeCount} students already marked</div>
          </div>
        </div>

        {/* Verification Methods */}
        <div>
          <h3 className={HIERARCHY.SECONDARY.className + ' mb-3'}>
            How would you like to mark attendance?
          </h3>

          {showFaceCapture ? (
            <FaceCaptureComponent
              onCapture={handleFaceCapture}
              onCancel={() => setShowFaceCapture(false)}
              isLoading={isFaceProcessing}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(selectedSession.attendanceMethod === 'FACE_RECOGNITION' ||
                selectedSession.attendanceMethod === 'BOTH') && (
                <button
                  onClick={handleMarkWithFace}
                  className="p-6 bg-slate-800 border-2 border-blue-600 rounded-lg hover:bg-blue-900/20 transition-all text-left"
                >
                  <div className="text-3xl mb-3">🔐</div>
                  <h4 className="font-semibold text-white mb-1">Face Recognition</h4>
                  <p className="text-sm text-slate-400">
                    Biometric verification. Quick and secure.
                  </p>
                  <div className="mt-4 text-xs text-blue-400 font-medium">→ Start</div>
                </button>
              )}

              {(selectedSession.attendanceMethod === 'QR_CODE' ||
                selectedSession.attendanceMethod === 'BOTH') && (
                <button
                  onClick={() => addToast({ type: 'info', title: 'QR Code', message: 'Scan QR code with phone camera' })}
                  className="p-6 bg-slate-800 border-2 border-slate-600 rounded-lg hover:border-slate-500 transition-all text-left"
                >
                  <div className="text-3xl mb-3">📱</div>
                  <h4 className="font-semibold text-white mb-1">Scan QR Code</h4>
                  <p className="text-sm text-slate-400">
                    Quick QR scan. Ask your instructor for the code.
                  </p>
                  <div className="mt-4 text-xs text-slate-400 font-medium">→ Setup</div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <h4 className="text-sm font-semibold text-white mb-2">📋 Instructions</h4>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• Make sure you're in a well-lit area</li>
            <li>• Face the camera directly</li>
            <li>• Keep your face fully visible in frame</li>
            <li>• The system will verify your identity</li>
          </ul>
        </div>

        {/* Back Button */}
        <button
          onClick={() => setMode('available-sessions')}
          className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-all"
        >
          ← Back to Sessions
        </button>
      </div>
    );
  };

  // ============ RENDER: SUCCESS ============
  const renderSuccess = () => {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-6 animate-bounce">✅</div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Attendance Marked Successfully!
        </h2>
        <p className="text-slate-400 mb-6">
          {lastMarkedSession?.courseName || ''}
        </p>

        {faceConfidence > 0 && (
          <div className="bg-blue-900/30 p-6 rounded-lg border border-blue-500 mb-6">
            <div className="text-sm text-slate-400 mb-2">Face Verification Confidence</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-slate-700 rounded-full h-3">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full"
                  style={{ width: `${faceConfidence}%` }}
                />
              </div>
              <div className="text-2xl font-bold text-blue-400">{faceConfidence.toFixed(0)}%</div>
            </div>
          </div>
        )}

        <div className="space-y-2 mb-8">
          <div className="text-green-400 text-sm">
            ✅ Identity verified
          </div>
          <div className="text-green-400 text-sm">
            ✅ Attendance recorded
          </div>
          <div className="text-green-400 text-sm">
            ✅ Session locked immutably
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setMode('available-sessions');
              setSelectedSession(null);
              setFaceConfidence(0);
            }}
            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-all text-white"
          >
            ← Mark Another Session
          </button>
          <button
            onClick={() => setMode('history')}
            className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-all"
          >
            📋 View History
          </button>
        </div>
      </div>
    );
  };

  // ============ RENDER: HISTORY ============
  const renderHistory = () => {
    return (
      <div className="space-y-4">
        <h3 className={HIERARCHY.SECONDARY.className + ' mb-4'}>
          Your Attendance History
        </h3>

        {history.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p>No attendance records yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((record) => (
              <div
                key={record.id}
                className="p-4 bg-slate-800 border border-slate-700 rounded-lg"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-slate-200">{record.courseName}</h4>
                    <p className="text-xs text-slate-500">{record.date}</p>
                  </div>
                  <div>
                    {record.status === 'PRESENT' && (
                      <span className="inline-block px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                        ✅ Present
                      </span>
                    )}
                    {record.status === 'ABSENT' && (
                      <span className="inline-block px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                        ❌ Absent
                      </span>
                    )}
                    {record.status === 'LATE' && (
                      <span className="inline-block px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded">
                        ⏰ Late
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-500 space-y-1">
                  <div>⏱️ {record.startTime} - {record.endTime}</div>
                  {record.verificationMethod && (
                    <div>
                      🔐 {record.verificationMethod}
                      {record.confidence && ` (${record.confidence}% confidence)`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setMode('available-sessions')}
          className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-all mt-6"
        >
          ← Back to Sessions
        </button>
      </div>
    );
  };

  // ============ MAIN RENDER ============
  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className={HIERARCHY.PRIMARY.className}>📍 Mark Your Attendance</h1>
          <p className={HIERARCHY.SECONDARY.className}>
            {user?.fullName || 'Student'} • {user?.role}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-slate-700">
          <button
            onClick={() => setMode('available-sessions')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'available-sessions'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Available Classes
          </button>
          <button
            onClick={() => setMode('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'history'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            History
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-400">
            <p>Loading sessions...</p>
          </div>
        ) : (
          <>
            {mode === 'available-sessions' && renderAvailableSessions()}
            {mode === 'mark-attendance' && renderMarkAttendance()}
            {mode === 'history' && renderHistory()}
            {mode === 'success' && renderSuccess()}
          </>
        )}
      </div>
    </div>
  );
};

export default EmployeeSelfServiceAttendance;
