/**
 * Faculty Attendance Workflow Page
 * 
 * Complete end-to-end attendance marking flow:
 * 1. Session Selection/Creation → System state locks
 * 2. Attendance Mode Selection → Face recognition primary
 * 3. Student Roster with Face Capture → Evidence collected
 * 4. Real-time Verification Status → Confidence scoring
 * 5. Session Closure → Immutable completion
 * 
 * Key: Once session starts, no edits allowed until locked
 */

import React, { useEffect, useState } from 'react';
import { useFacultyStore } from '../store/facultyStore';
import { useAuthStore } from '../store/authStore';
import { ErrorAlert } from '../components/ErrorDisplay';
import { LoadingOverlay } from '../components/LoadingStates';
import { useToastStore } from '../components/Toast';
import { HIERARCHY } from '../utils/visualHierarchy';
import FaceCaptureComponent from '../components/FaceCaptureComponent';
import {
  type FaceCapture,
} from '../services/faceEncodingService';
import { verifyFaceWithBackend } from '../services/faceVerificationAPI';

// Workflow Stages
type WorkflowStage = 
  | 'session-selection' 
  | 'mode-selection' 
  | 'roster-review' 
  | 'attendance-marking' 
  | 'session-locked' 
  | 'session-closed';

interface SessionInfo {
  id: string;
  courseId: string;
  courseName: string;
  sessionNumber: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
  status: 'SCHEDULED' | 'IN_SESSION' | 'CLOSED';
  lecturerId: string;
  studentCount: number;
  markedCount: number;
}

interface StudentMarking {
  studentId: string;
  name: string;
  enrollmentId?: string;
  marked: boolean;
  markedAt?: string;
  verificationMethod: 'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL' | null;
  faceVerified: boolean;
  confidence?: number;
  notes?: string;
  faceEmbedding?: number[];
}

export const FacultyAttendanceWorkflowPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const addToast = useToastStore((state) => state.addToast);
  const {
    courses,
    selectedCourseId,
    courseRoster,
    error,
    clearError,
    fetchCourses,
    selectCourse,
  } = useFacultyStore();

  // Workflow state
  const [stage, setStage] = useState<WorkflowStage>('session-selection');
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [markingMode, setMarkingMode] = useState<'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL'>('FACE_RECOGNITION');
  const [studentMarkings, setStudentMarkings] = useState<StudentMarking[]>([]);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [currentStudent, setCurrentStudent] = useState<StudentMarking | null>(null);
  
  // Face capture state
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [isFaceProcessing, setIsFaceProcessing] = useState(false);

  // Load courses on mount
  useEffect(() => {
    if (!courses.length) {
      fetchCourses();
    }
  }, []);

  // Initialize roster when course selected
  useEffect(() => {
    if (selectedCourseId && courseRoster) {
      // Initialize student markings from roster
      const markings: StudentMarking[] = (courseRoster.students || []).map((student: any) => ({
        studentId: student.id,
        name: student.name || `${student.first_name} ${student.last_name}`,
        enrollmentId: student.enrollment_id,
        marked: false,
        verificationMethod: null,
        faceVerified: false,
      }));
      setStudentMarkings(markings);
      setStage('mode-selection');
    }
  }, [selectedCourseId, courseRoster]);

  // ============ STAGE 1: SESSION SELECTION ============
  const handleSelectSession = async (courseId: string) => {
    await selectCourse(courseId);
    setActiveSession({
      id: `session-${Date.now()}`, // In real app, comes from backend
      courseId,
      courseName: courses.find((c) => c.id === courseId)?.name || '',
      sessionNumber: 1,
      sessionDate: new Date().toISOString().split('T')[0],
      startTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      endTime: new Date(Date.now() + 60 * 60 * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      status: 'IN_SESSION',
      lecturerId: user?.id || '',
      location: 'Classroom A',
      studentCount: courseRoster?.students?.length || 0,
      markedCount: 0,
    });
  };

  // ============ STAGE 2: MODE SELECTION ============
  const handleModeSelection = (mode: 'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL') => {
    setMarkingMode(mode);
    setStage('roster-review');
  };

  // ============ STAGE 3: ROSTER REVIEW ============
  const handleProceedToMarking = () => {
    // Lock session state
    setSessionLocked(true);
    setStage('attendance-marking');
    addToast({ type: 'success', title: 'Session Locked', message: 'Attendance marking started' });
  };

  // ============ STAGE 4: MARK ATTENDANCE ============
  // Handle captured face and verify against enrollment via backend
  const handleFaceCapture = async (face: FaceCapture) => {
    if (!currentStudent || !activeSession) return;

    try {
      setIsFaceProcessing(true);

      // Send to backend for verification
      const result = await verifyFaceWithBackend({
        sessionId: activeSession.id,
        studentId: currentStudent.studentId,
        embedding: face.embedding,
        imageMetadata: face.imageMetadata,
      });

      // Update student marking
      setStudentMarkings((prev) =>
        prev.map((s) =>
          s.studentId === currentStudent.studentId
            ? {
                ...s,
                marked: true,
                markedAt: new Date().toISOString(),
                verificationMethod: 'FACE_RECOGNITION',
                faceVerified: result.verified,
                confidence: result.confidence,
                faceEmbedding: face.embedding,
                notes: result.warnings?.join('; '),
              }
            : s
        )
      );

      addToast({
        type: result.verified ? 'success' : 'warning',
        title: result.verified ? '✅ Face Verified' : '⚠️ Low Confidence',
        message: `${currentStudent.name} - ${result.confidence}% confidence`,
      });

      setShowFaceCapture(false);
      setCurrentStudent(null);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Verification Failed',
        message: `Could not verify ${currentStudent?.name}: ${err.message}`,
      });
    } finally {
      setIsFaceProcessing(false);
    }
  };

  const handleMarkStudent = async (studentId: string, method: 'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL') => {
    const student = studentMarkings.find((s) => s.studentId === studentId);
    if (!student) return;

    // For face recognition, show capture UI
    if (method === 'FACE_RECOGNITION') {
      setCurrentStudent(student);
      setShowFaceCapture(true);
      return;
    }

    // For manual or QR marking
    setStudentMarkings((prev) =>
      prev.map((s) =>
        s.studentId === studentId
          ? {
              ...s,
              marked: true,
              markedAt: new Date().toISOString(),
              verificationMethod: method,
              faceVerified: false,
            }
          : s
      )
    );
    addToast({ type: 'success', title: 'Marked Present', message: `${student.name}` });
    setCurrentStudent(null);
  };

  // ============ STAGE 5: LOCK SESSION ============
  const handleLockSession = async () => {
    const marked = studentMarkings.filter((s) => s.marked).length;
    const total = studentMarkings.length;
    
    setStage('session-locked');
    addToast({ type: 'success', title: 'Session Locked', message: `${marked}/${total} students marked` });
  };

  // ============ STAGE 6: SUBMIT & CLOSE ============
  const handleSubmitAttendance = async () => {
    try {
      // In real app: batch submit to backend
      const payload = {
        sessionId: activeSession?.id,
        attendanceData: studentMarkings.map((s) => ({
          studentId: s.studentId,
          status: s.marked ? 'present' : 'absent',
          verificationMethod: s.verificationMethod,
          faceVerified: s.faceVerified,
          confidence: s.confidence,
        })),
      };

      console.log('[Attendance Submission]', payload);

      setStage('session-closed');
      addToast({ type: 'success', title: 'Submitted', message: 'Attendance locked immutably' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Submission Failed', message: 'Could not submit attendance' });
    }
  };

  // ============ RENDER: SESSION SELECTION ============
  if (stage === 'session-selection' || !selectedCourseId) {
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className={HIERARCHY.PRIMARY.className}>📚 Start Attendance Session</h1>
          <p className={HIERARCHY.SECONDARY.className}>
            Select a course to begin marking attendance. Once started, the session will be locked for immutable marking.
          </p>

          {error && <ErrorAlert title="Error" message={error} onDismiss={clearError} />}

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {courses.length === 0 ? (
              <div className="text-center py-12 text-slate-400 col-span-full">
                <p className="text-lg">No courses assigned</p>
              </div>
            ) : (
              courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => handleSelectSession(course.id)}
                  className="p-6 rounded-lg border-2 border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700/50 transition-all text-left"
                >
                  <div className={HIERARCHY.PRIMARY.className}>{course.name}</div>
                  <div className="text-sm text-slate-400 mt-2">
                    📊 {course.students_count || 0} students
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Click to start session</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: MODE SELECTION ============
  if (stage === 'mode-selection') {
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className={HIERARCHY.PRIMARY.className}>🎯 Select Attendance Method</h1>
            <p className={HIERARCHY.SECONDARY.className}>
              Choose how students will verify their presence. {activeSession?.courseName}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Face Recognition */}
            <button
              onClick={() => handleModeSelection('FACE_RECOGNITION')}
              className="p-8 rounded-lg border-2 border-blue-500 bg-blue-500/10 hover:bg-blue-500/20 transition-all text-left"
            >
              <div className="text-3xl mb-3">🔐</div>
              <div className={HIERARCHY.PRIMARY.className}>Face Recognition</div>
              <p className="text-sm text-slate-400 mt-2">
                Biometric verification with confidence scoring. Recommended for accuracy.
              </p>
              <div className="mt-4 text-xs text-blue-400">✅ Primary Method</div>
            </button>

            {/* QR Code */}
            <button
              onClick={() => handleModeSelection('QR_CODE')}
              className="p-8 rounded-lg border-2 border-slate-600 bg-slate-800 hover:border-slate-500 transition-all text-left"
            >
              <div className="text-3xl mb-3">📱</div>
              <div className={HIERARCHY.PRIMARY.className}>QR Code</div>
              <p className="text-sm text-slate-400 mt-2">
                Quick scan-based verification. Good for large classes.
              </p>
            </button>

            {/* Manual */}
            <button
              onClick={() => handleModeSelection('MANUAL')}
              className="p-8 rounded-lg border-2 border-slate-600 bg-slate-800 hover:border-slate-500 transition-all text-left"
            >
              <div className="text-3xl mb-3">✍️</div>
              <div className={HIERARCHY.PRIMARY.className}>Manual Marking</div>
              <p className="text-sm text-slate-400 mt-2">
                Click to mark each student. Useful for makeup sessions.
              </p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: ROSTER REVIEW ============
  if (stage === 'roster-review') {
    const markedCount = studentMarkings.filter((s) => s.marked).length;

    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className={HIERARCHY.PRIMARY.className}>📋 Class Roster</h1>
              <p className={HIERARCHY.SECONDARY.className}>
                {activeSession?.courseName} • {activeSession?.sessionDate} {activeSession?.startTime}-{activeSession?.endTime}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-400">{markedCount}</div>
              <div className="text-xs text-slate-400">marked of {studentMarkings.length}</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span>Session Progress</span>
              <span>{Math.round((markedCount / studentMarkings.length) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(markedCount / studentMarkings.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Student Table */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden mb-6">
            <table className="w-full">
              <thead className="bg-slate-700 border-b border-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Name</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-300">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {studentMarkings.map((student) => (
                  <tr key={student.studentId} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-sm text-slate-300">{student.name}</td>
                    <td className="px-4 py-3 text-center">
                      {student.marked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                          ✅ Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-700 text-slate-400 text-xs rounded">
                          ⏳ Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-400">
                      {student.verificationMethod || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setStage('mode-selection')}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-all"
            >
              ← Back
            </button>
            <button
              onClick={handleProceedToMarking}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-all"
            >
              🔒 Lock Session & Begin Marking
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: ATTENDANCE MARKING ============
  if (stage === 'attendance-marking') {
    const markedCount = studentMarkings.filter((s) => s.marked).length;
    const unmarked = studentMarkings.filter((s) => !s.marked);

    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header with Status */}
          <div className="mb-6 bg-gradient-to-r from-blue-600 to-blue-800 p-6 rounded-lg border border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white">🔐 Session LOCKED</h1>
                <p className="text-blue-100 mt-1">Attendance marking in progress. No edits allowed.</p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-white">{markedCount}/{studentMarkings.length}</div>
                <div className="text-xs text-blue-300">Students Marked</div>
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span>Completion</span>
              <span>{Math.round((markedCount / studentMarkings.length) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-300"
                style={{ width: `${(markedCount / studentMarkings.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Two Column Layout */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left: Remaining Students */}
            <div className="lg:col-span-2">
              <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                <div className="bg-slate-700 px-4 py-3 border-b border-slate-600">
                  <h3 className="font-semibold text-slate-300">
                    📌 Remaining Students ({unmarked.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-700 max-h-96 overflow-y-auto">
                  {unmarked.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      <p>🎉 All students marked!</p>
                    </div>
                  ) : (
                    unmarked.map((student) => (
                      <div
                        key={student.studentId}
                        className="p-4 hover:bg-slate-700/50 cursor-pointer transition-colors"
                        onClick={() => setCurrentStudent(student)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-200">{student.name}</div>
                            <div className="text-xs text-slate-500 mt-1">Click to mark</div>
                          </div>
                          <div className="text-xl">→</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right: Current Student & Marking */}
            {currentStudent && (
              <div className="bg-slate-800 rounded-lg border border-blue-500 overflow-hidden">
                <div className="bg-blue-900 px-4 py-3 border-b border-blue-700">
                  <h3 className="font-semibold text-white">👤 Current Student</h3>
                </div>
                <div className="p-6">
                  <div className="text-center mb-6">
                    <div className="w-24 h-24 mx-auto bg-slate-700 rounded-full flex items-center justify-center mb-3">
                      👨‍🎓
                    </div>
                    <h4 className="text-lg font-semibold text-white">{currentStudent.name}</h4>
                    <p className="text-xs text-slate-500 mt-1">{currentStudent.studentId}</p>
                  </div>

                  {showFaceCapture ? (
                    <FaceCaptureComponent
                      onCapture={handleFaceCapture}
                      onCancel={() => {
                        setShowFaceCapture(false);
                        setCurrentStudent(null);
                      }}
                      isLoading={isFaceProcessing}
                    />
                  ) : (
                    <>
                      {markingMode === 'FACE_RECOGNITION' ? (
                        <button
                          onClick={() => handleMarkStudent(currentStudent.studentId, 'FACE_RECOGNITION')}
                          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all mb-3 flex items-center justify-center gap-2"
                        >
                          🔐 Capture Face
                        </button>
                      ) : null}

                      <button
                        onClick={() => {
                          handleMarkStudent(currentStudent.studentId, markingMode);
                        }}
                        className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all"
                      >
                        ✅ Mark Present
                      </button>

                      <button
                        onClick={() => setCurrentStudent(null)}
                        className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-medium transition-all mt-2"
                      >
                        × Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-4">
            <button
              onClick={() => setStage('roster-review')}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-all"
              disabled={sessionLocked}
            >
              ← Unlock & Edit Roster
            </button>
            <button
              onClick={handleLockSession}
              className="flex-1 px-6 py-3 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium transition-all"
            >
              🔐 Lock & Submit Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: SESSION LOCKED ============
  if (stage === 'session-locked') {
    const markedCount = studentMarkings.filter((s) => s.marked).length;
    const faceVerified = studentMarkings.filter((s) => s.faceVerified).length;

    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🔒</div>
            <h1 className={HIERARCHY.PRIMARY.className}>Session Locked & Ready for Submit</h1>
            <p className={HIERARCHY.SECONDARY.className}>
              All attendance data has been captured. Review before final submission.
            </p>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <div className="text-3xl font-bold text-blue-400">{markedCount}</div>
              <div className="text-sm text-slate-400 mt-2">Students Present</div>
            </div>
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <div className="text-3xl font-bold text-green-400">{faceVerified}</div>
              <div className="text-sm text-slate-400 mt-2">Face Verified</div>
            </div>
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <div className="text-3xl font-bold text-amber-400">{studentMarkings.length - markedCount}</div>
              <div className="text-sm text-slate-400 mt-2">Absent</div>
            </div>
          </div>

          {/* Final Summary Table */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden mb-8">
            <div className="bg-slate-700 px-6 py-3 border-b border-slate-600">
              <h3 className="font-semibold text-slate-300">Final Attendance Summary</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-600 bg-slate-700/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Student</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-slate-300">Status</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-slate-300">Method</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-slate-300">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {studentMarkings.slice(0, 10).map((student) => (
                  <tr key={student.studentId} className="hover:bg-slate-700/30">
                    <td className="px-6 py-3 text-sm text-slate-300">{student.name}</td>
                    <td className="px-6 py-3 text-center">
                      {student.marked ? (
                        <span className="inline-block px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                          Present
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                          Absent
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-center text-xs text-slate-400">
                      {student.verificationMethod || '—'}
                    </td>
                    <td className="px-6 py-3 text-center text-xs text-slate-400">
                      {student.confidence ? `${student.confidence.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {studentMarkings.length > 10 && (
              <div className="px-6 py-3 text-center text-xs text-slate-500 bg-slate-700/30">
                ... and {studentMarkings.length - 10} more students
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={() => setStage('attendance-marking')}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-all"
            >
              ← Go Back to Marking
            </button>
            <button
              onClick={handleSubmitAttendance}
              className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-all text-white"
            >
              ✅ Submit & Lock Immutably
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: SESSION CLOSED ============
  if (stage === 'session-closed') {
    const markedCount = studentMarkings.filter((s) => s.marked).length;

    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">✅</div>
            <h1 className={HIERARCHY.PRIMARY.className}>Session Closed & Immutable</h1>
            <p className={HIERARCHY.SECONDARY.className}>
              Attendance has been permanently recorded and locked. No further changes allowed.
            </p>
          </div>

          {/* Success Box */}
          <div className="bg-gradient-to-r from-green-900 to-green-800 border border-green-600 p-8 rounded-lg mb-8">
            <div className="grid gap-6 md:grid-cols-3 text-center">
              <div>
                <div className="text-4xl font-bold text-green-300">{markedCount}/{studentMarkings.length}</div>
                <div className="text-sm text-green-200 mt-2">Marked Present</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-green-300">
                  {studentMarkings.filter((s) => s.faceVerified).length}
                </div>
                <div className="text-sm text-green-200 mt-2">Face Verified</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-green-300">100%</div>
                <div className="text-sm text-green-200 mt-2">Locked</div>
              </div>
            </div>
          </div>

          {/* Receipt-like summary */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 mb-8 font-mono text-sm">
            <div className="text-slate-400 mb-4">═══════════════════════════════</div>
            <div className="space-y-2 text-slate-300">
              <div>Session ID: {activeSession?.id}</div>
              <div>Course: {activeSession?.courseName}</div>
              <div>Date: {activeSession?.sessionDate}</div>
              <div>Time: {activeSession?.startTime} - {activeSession?.endTime}</div>
              <div>Lecturer: {user?.email}</div>
              <div>Total Students: {studentMarkings.length}</div>
              <div>Marked: {markedCount}</div>
              <div>Absent: {studentMarkings.length - markedCount}</div>
            </div>
            <div className="text-slate-400 mt-4 mb-4">═══════════════════════════════</div>
            <div className="text-xs text-slate-500">
              Submitted: {new Date().toISOString()}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={() => {
                setStage('session-selection');
                setActiveSession(null);
              }}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-all text-white"
            >
              ✅ Start New Session
            </button>
            <button
              onClick={() => console.log('Download report')}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-all"
            >
              📥 Download Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <LoadingOverlay message="Loading..." />;
};

export default FacultyAttendanceWorkflowPage;
