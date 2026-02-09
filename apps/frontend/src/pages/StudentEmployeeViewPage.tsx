/**
 * Student/Employee View Page
 * 
 * Self-service attendance view (read-mostly)
 * Shows: Profile, attendance %, breakdown by course, discrepancies, export
 */

import React, { useEffect } from 'react';
import { useAttendanceStore } from '../store/attendanceStore';
import { ErrorAlert } from '../components/ErrorDisplay';
import { LoadingOverlay } from '../components/LoadingStates';
import { HIERARCHY, STATUS_COLORS, getAttendanceStatus } from '../utils/visualHierarchy';

export const StudentEmployeeViewPage: React.FC = () => {
  const {
    profile,
    metrics,
    courses,
    isLoading,
    error,
    clearError,
    fetchProfile,
    fetchMetrics,
    fetchCourseBreakdown
  } = useAttendanceStore();

  useEffect(() => {
    fetchProfile();
    fetchMetrics();
    fetchCourseBreakdown();
  }, []);

  if (isLoading && !profile) {
    return <LoadingOverlay message="Loading your attendance..." />;
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      {error && (
        <ErrorAlert
          title="Failed to load attendance"
          message={error}
          action={{ label: 'Retry', onClick: () => fetchProfile() }}
          onDismiss={clearError}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-8">
        {/* Profile Card */}
        {profile && (
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <div className={HIERARCHY.PRIMARY.className}>{profile.full_name}</div>
            <div className={HIERARCHY.SECONDARY.className}>{profile.email}</div>
            <div className={`mt-2 ${HIERARCHY.TERTIARY.className}`}>ID: {profile.id}</div>
          </div>
        )}

        {/* Overall Attendance Metric */}
        {metrics && (
          <div className={`p-6 rounded-lg border-2 ${STATUS_COLORS[getAttendanceStatus(metrics.overall_percentage)]}`}>
            <div className={HIERARCHY.PRIMARY.className}>Overall Attendance</div>
            <div className="text-4xl font-bold mt-2">{metrics.overall_percentage}%</div>
            <div className={HIERARCHY.SECONDARY.className}>
              {metrics.present} Present • {metrics.absent} Absent • {metrics.late} Late
            </div>
          </div>
        )}

        {/* Course Breakdown */}
        {courses.length > 0 && (
          <div>
            <h2 className={HIERARCHY.PRIMARY.className}>Attendance by Course</h2>
            <div className="mt-4 space-y-3">
              {courses.map((course) => (
                <div
                  key={course.course_id}
                  className={`p-4 rounded-lg border border-slate-700 bg-slate-800/50 ${
                    STATUS_COLORS[getAttendanceStatus(course.percentage)]
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className={HIERARCHY.PRIMARY.className}>
                        {course.course_name}
                      </div>
                      <div className={HIERARCHY.SECONDARY.className}>
                        {course.present} Present • {course.absent} Absent
                      </div>
                    </div>
                    <div className="text-2xl font-bold">{course.percentage}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {courses.length === 0 && !isLoading && (
          <ErrorDisplay.EmptyState
            title="No enrollment found"
            message="You are not enrolled in any courses yet"
          />
        )}
      </div>
    </div>
  );
};

export default StudentEmployeeViewPage;
