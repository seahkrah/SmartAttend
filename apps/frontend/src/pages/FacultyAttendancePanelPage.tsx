/**
 * Faculty Attendance Panel Page
 * 
 * Wrapper for Faculty attendance marking with step workflow
 * Shows: Active courses → Select date → Mark → Submit → Finalize
 */

import React, { useEffect } from 'react';
import { useFacultyStore } from '../store/facultyStore';
import { ErrorAlert } from '../components/ErrorDisplay';
import { LoadingOverlay } from '../components/LoadingStates';
import { HIERARCHY } from '../utils/visualHierarchy';

export const FacultyAttendancePanelPage: React.FC = () => {
  const { 
    courses, 
    isLoading, 
    error, 
    clearError, 
    fetchCourses,
    selectedCourseId,
    selectCourse,
    courseRoster,
    markedCount,
    totalCount
  } = useFacultyStore();

  useEffect(() => {
    fetchCourses();
  }, []);

  if (isLoading && courses.length === 0) {
    return <LoadingOverlay message="Loading your courses..." />;
  }

  return (
    <div className="min-h-screen bg-card p-6">
      {error && (
        <ErrorAlert
          title="Failed to load courses"
          message={error}
          action={{ label: 'Retry', onClick: () => fetchCourses() }}
          onDismiss={clearError}
        />
      )}

      <div className="max-w-6xl mx-auto">
        {/* Header with hierarchy */}
        <h1 className={HIERARCHY.PRIMARY.className}>Mark Attendance</h1>
        <p className={HIERARCHY.SECONDARY.className}>
          Select a course to begin marking attendance
        </p>

        {/* Course Selection */}
        <div className="mt-8 grid gap-4">
          {courses.length === 0 ? (
            <div className="text-center py-8 text-secondary">
              <p className="text-lg">No courses assigned</p>
              <p className="text-sm">You don't have any active courses for attendance marking</p>
            </div>
          ) : (
            courses.map((course) => (
              <button
                key={course.id}
                onClick={() => selectCourse(course.id)}
                className={`p-6 rounded-lg border-2 transition-all ${
                  selectedCourseId === course.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-subtle bg-sunken hover:border-strong'
                }`}
              >
                <div className={HIERARCHY.PRIMARY.className}>{course.name}</div>
                <div className={HIERARCHY.SECONDARY.className}>{course.code}</div>
              </button>
            ))
          )}
        </div>

        {/* Progress if course selected */}
        {selectedCourseId && courseRoster && (
          <div className="mt-8 p-6 bg-sunken rounded-lg border border-subtle">
            <div className={HIERARCHY.PRIMARY.className}>Progress</div>
            <div className="flex items-center gap-4">
              <div className="flex-1 bg-sunken rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${(markedCount / totalCount) * 100}%` }}
                />
              </div>
              <span className="text-sm text-secondary">{markedCount}/{totalCount}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FacultyAttendancePanelPage;
