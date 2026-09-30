import { axiosClient } from '../utils/axiosClient';

/**
 * SMS academic structure: years, terms, programmes, curriculum and which
 * programme a student is reading.
 *
 * The tenant is never sent. It is resolved server-side from the authenticated
 * identity, so nothing here takes a tenant id and nothing here could send one.
 */

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  status: 'planned' | 'active' | 'closed';
  term_count?: number;
}

export interface Term {
  id: string;
  name: string;
  department_id: string;
  academic_year_id?: string | null;
  academic_year?: string | null;
  department_name?: string;
  start_date: string;
  end_date: string;
  sequence?: number | null;
  is_active: boolean;
  course_count?: number;
}

export interface Programme {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  award?: string | null;
  level?: string | null;
  duration_years: number;
  credits_required?: number | null;
  is_active: boolean;
  department_id?: string | null;
  department_name?: string | null;
  course_count?: number;
  student_count?: number;
}

export interface CurriculumEntry {
  id: string;
  programme_id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  course_credits?: number | null;
  study_year: number;
  term_sequence?: number | null;
  requirement: 'core' | 'elective' | 'optional';
  credits?: number | null;
}

export interface StudentProgramme {
  id: string;
  programme_id: string;
  programme_code: string;
  programme_name: string;
  award?: string | null;
  credits_required?: number | null;
  academic_year?: string | null;
  entry_year: number;
  current_study_year: number;
  status: 'active' | 'deferred' | 'withdrawn' | 'graduated' | 'dismissed';
  started_at: string;
  completed_at?: string | null;
}

export const academicsService = {
  async listYears(): Promise<AcademicYear[]> {
    const { data } = await axiosClient.get('/academics/years');
    return data.years;
  },

  async createYear(input: {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
  }): Promise<AcademicYear> {
    const { data } = await axiosClient.post('/academics/years', input);
    return data.year;
  },

  async updateYear(id: string, input: Partial<{
    name: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    status: string;
  }>): Promise<AcademicYear> {
    const { data } = await axiosClient.patch(`/academics/years/${id}`, input);
    return data.year;
  },

  async deleteYear(id: string): Promise<void> {
    await axiosClient.delete(`/academics/years/${id}`);
  },

  async listTerms(yearId?: string): Promise<Term[]> {
    const { data } = await axiosClient.get('/academics/terms', {
      params: yearId ? { yearId } : undefined,
    });
    return data.terms;
  },

  async createTerm(input: {
    name: string;
    departmentId: string;
    academicYearId?: string;
    startDate: string;
    endDate: string;
    sequence?: number;
    isActive?: boolean;
  }): Promise<Term> {
    const { data } = await axiosClient.post('/academics/terms', input);
    return data.term;
  },

  async listProgrammes(): Promise<Programme[]> {
    const { data } = await axiosClient.get('/academics/programmes');
    return data.programmes;
  },

  async getProgramme(id: string): Promise<{ programme: Programme; curriculum: CurriculumEntry[] }> {
    const { data } = await axiosClient.get(`/academics/programmes/${id}`);
    return data;
  },

  async createProgramme(input: {
    code: string;
    name: string;
    departmentId?: string;
    description?: string;
    award?: string;
    level?: string;
    durationYears?: number;
    creditsRequired?: number;
  }): Promise<Programme> {
    const { data } = await axiosClient.post('/academics/programmes', input);
    return data.programme;
  },

  async updateProgramme(id: string, input: Record<string, unknown>): Promise<Programme> {
    const { data } = await axiosClient.patch(`/academics/programmes/${id}`, input);
    return data.programme;
  },

  async deleteProgramme(id: string): Promise<void> {
    await axiosClient.delete(`/academics/programmes/${id}`);
  },

  async addCourseToProgramme(programmeId: string, input: {
    courseId: string;
    studyYear: number;
    termSequence?: number;
    requirement?: string;
    credits?: number;
  }): Promise<CurriculumEntry> {
    const { data } = await axiosClient.post(`/academics/programmes/${programmeId}/courses`, input);
    return data.entry;
  },

  async removeCourseFromProgramme(programmeId: string, entryId: string): Promise<void> {
    await axiosClient.delete(`/academics/programmes/${programmeId}/courses/${entryId}`);
  },

  async studentProgrammes(studentId: string): Promise<StudentProgramme[]> {
    const { data } = await axiosClient.get(`/academics/students/${studentId}/programme`);
    return data.enrolments;
  },

  async enrolStudent(studentId: string, input: {
    programmeId: string;
    academicYearId?: string;
    entryYear?: number;
    currentStudyYear?: number;
  }): Promise<StudentProgramme> {
    const { data } = await axiosClient.post(`/academics/students/${studentId}/programme`, input);
    return data.enrolment;
  },
};
