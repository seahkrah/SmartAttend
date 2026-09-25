import { axiosClient } from '../utils/axiosClient';

/**
 * SMS gradebook: grading schemes, assessments, marks, results, transcripts.
 *
 * As with academics, the tenant is resolved server-side and is never a
 * parameter here.
 */

export interface GradeBand {
  id: string;
  scheme_id: string;
  letter: string;
  min_score: number;
  max_score: number;
  grade_point: number;
  is_pass: boolean;
  remark?: string | null;
}

export interface GradingScheme {
  id: string;
  name: string;
  description?: string | null;
  max_grade_point: number;
  pass_mark: number;
  is_default: boolean;
  bands: GradeBand[];
}

export type AssessmentKind =
  | 'assignment' | 'quiz' | 'test' | 'midterm'
  | 'exam' | 'project' | 'practical' | 'participation';

export interface Assessment {
  id: string;
  course_id: string;
  semester_id?: string | null;
  title: string;
  kind: AssessmentKind;
  max_score: number;
  weight: number;
  due_date?: string | null;
  published: boolean;
  graded_count?: number;
}

export type ScoreStatus = 'graded' | 'pending' | 'absent' | 'excused' | 'submitted';

export interface MarkRow {
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  score: number | null;
  status: ScoreStatus | null;
  feedback?: string | null;
  graded_at?: string | null;
}

export interface CourseResult {
  studentId: string;
  totalScore: number;
  weightGraded: number;
  weightDeclared: number;
  pending: number;
  letter: string | null;
  gradePoint: number | null;
  isPass: boolean | null;
  student: { id: string; student_id: string; first_name: string; last_name: string } | null;
  status: 'unsaved' | 'provisional' | 'published' | 'withheld';
  publishedAt: string | null;
  /** The stored result, once there is one; needed to withhold it. */
  resultId: string | null;
}

export interface TranscriptEntry {
  course_code: string;
  course_name: string;
  semester_name?: string | null;
  academic_year?: string | null;
  total_score: number;
  letter: string;
  grade_point: number;
  credits: number;
  is_pass: boolean;
  published_at: string;
}

export interface Transcript {
  student: { id: string; studentNumber: string; firstName: string; lastName: string };
  programme: {
    code: string; name: string; award?: string | null;
    credits_required?: number | null; current_study_year: number; status: string;
  } | null;
  entries: TranscriptEntry[];
  cgpa: number | null;
  gpa: number | null;
  creditsEarned: number;
  creditsAttempted: number;
  /** False when no result carried credits, so the GPA is a plain mean. */
  creditWeighted: boolean;
}

export const gradebookService = {
  async listSchemes(): Promise<GradingScheme[]> {
    const { data } = await axiosClient.get('/gradebook/schemes');
    return data.schemes;
  },

  async createScheme(input: {
    name: string;
    description?: string;
    passMark?: number;
    maxGradePoint?: number;
    isDefault?: boolean;
    bands: Array<{
      letter: string; minScore: number; maxScore: number;
      gradePoint: number; isPass?: boolean; remark?: string;
    }>;
  }): Promise<GradingScheme> {
    const { data } = await axiosClient.post('/gradebook/schemes', input);
    return data.scheme;
  },

  async deleteScheme(id: string): Promise<void> {
    await axiosClient.delete(`/gradebook/schemes/${id}`);
  },

  async listAssessments(courseId: string): Promise<{
    assessments: Assessment[];
    weightTotal: number;
    weightComplete: boolean;
  }> {
    const { data } = await axiosClient.get(`/gradebook/courses/${courseId}/assessments`);
    return data;
  },

  async createAssessment(courseId: string, input: {
    title: string;
    kind?: AssessmentKind;
    maxScore?: number;
    weight: number;
    dueDate?: string;
    semesterId?: string;
  }): Promise<Assessment> {
    const { data } = await axiosClient.post(`/gradebook/courses/${courseId}/assessments`, input);
    return data.assessment;
  },

  async updateAssessment(id: string, input: Record<string, unknown>): Promise<Assessment> {
    const { data } = await axiosClient.patch(`/gradebook/assessments/${id}`, input);
    return data.assessment;
  },

  async deleteAssessment(id: string): Promise<void> {
    await axiosClient.delete(`/gradebook/assessments/${id}`);
  },

  async markSheet(assessmentId: string): Promise<{ assessment: Assessment; scores: MarkRow[] }> {
    const { data } = await axiosClient.get(`/gradebook/assessments/${assessmentId}/scores`);
    return data;
  },

  async saveMarks(assessmentId: string, scores: Array<{
    studentId: string; score?: number | null; status?: ScoreStatus; feedback?: string;
  }>): Promise<{ written: number }> {
    const { data } = await axiosClient.put(`/gradebook/assessments/${assessmentId}/scores`, { scores });
    return data;
  },

  async results(courseId: string, semesterId?: string): Promise<{
    course: { id: string; code: string; name: string };
    scheme: { id: string; name: string; passMark: number };
    results: CourseResult[];
  }> {
    const { data } = await axiosClient.get(`/gradebook/courses/${courseId}/results`, {
      params: semesterId ? { semesterId } : undefined,
    });
    return data;
  },

  async publish(courseId: string, input?: { semesterId?: string; force?: boolean }): Promise<{
    published: number; skipped: number; message: string;
  }> {
    const { data } = await axiosClient.post(`/gradebook/courses/${courseId}/results/publish`, input ?? {});
    return data;
  },

  /** Takes a published result back out of the transcript, pending review. */
  async withhold(resultId: string): Promise<void> {
    await axiosClient.post(`/gradebook/results/${resultId}/withhold`);
  },

  /**
   * The caller's own transcript.
   *
   * Separate from `transcript` because a student knows their user id and not
   * their student id, and the two are different rows.
   */
  async myTranscript(academicYearId?: string): Promise<Transcript> {
    const { data } = await axiosClient.get('/gradebook/my/transcript', {
      params: { academicYearId },
    });
    return data;
  },

  async transcript(studentId: string, academicYearId?: string): Promise<Transcript> {
    const { data } = await axiosClient.get(`/gradebook/students/${studentId}/transcript`, {
      params: academicYearId ? { academicYearId } : undefined,
    });
    return data;
  },
};
