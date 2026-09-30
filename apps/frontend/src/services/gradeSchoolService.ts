import { axiosClient } from '../utils/axiosClient';

/**
 * A grade school's classes and subjects (/api/grade-school).
 *
 * A grade is divided into classes each academic year (Grade 4A, Grade 4B),
 * each with a class teacher; a student sits in one class a year. The tenant
 * is resolved on the server from the signed-in identity and never sent.
 */

export interface SchoolClass {
  id: string;
  name: string;
  display_name: string;
  capacity: number | null;
  academic_year_id: string;
  grade_level_id: string;
  grade_code: string;
  grade_name: string;
  stage: string;
  sort_order: number;
  class_teacher_id: string | null;
  class_teacher_name: string | null;
  student_count: number;
}

export interface AcademicYearRef {
  id: string;
  name: string;
  is_current: boolean;
}

export interface Teacher {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  title: string | null;
}

export interface ClassStudent {
  id: string;
  student_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender?: string | null;
  status?: string | null;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  grade_level_ids: string[];
}

export const gradeSchoolService = {
  async listClasses(params: { yearId?: string; mine?: boolean } = {}): Promise<{ year: AcademicYearRef | null; classes: SchoolClass[] }> {
    const { data } = await axiosClient.get('/grade-school/classes', {
      params: { yearId: params.yearId || undefined, mine: params.mine ? '1' : undefined },
    });
    return data;
  },
  async createClass(body: { academicYearId: string; gradeLevelId: string; name: string; classTeacherId?: string | null; capacity?: number | null }): Promise<SchoolClass> {
    const { data } = await axiosClient.post('/grade-school/classes', body);
    return data.class;
  },
  async updateClass(id: string, body: { name?: string; classTeacherId?: string | null; capacity?: number | null }): Promise<SchoolClass> {
    const { data } = await axiosClient.patch(`/grade-school/classes/${id}`, body);
    return data.class;
  },
  async deleteClass(id: string): Promise<void> {
    await axiosClient.delete(`/grade-school/classes/${id}`);
  },
  async classStudents(id: string): Promise<ClassStudent[]> {
    const { data } = await axiosClient.get(`/grade-school/classes/${id}/students`);
    return data.students ?? [];
  },
  async placeStudents(id: string, studentIds: string[]): Promise<number> {
    const { data } = await axiosClient.post(`/grade-school/classes/${id}/students`, { studentIds });
    return data.placed;
  },
  async removeStudent(id: string, studentId: string): Promise<void> {
    await axiosClient.delete(`/grade-school/classes/${id}/students/${studentId}`);
  },
  async unplacedStudents(yearId?: string): Promise<ClassStudent[]> {
    const { data } = await axiosClient.get('/grade-school/unplaced-students', { params: { yearId: yearId || undefined } });
    return data.students ?? [];
  },
  async teachers(): Promise<Teacher[]> {
    const { data } = await axiosClient.get('/grade-school/teachers');
    return data.teachers ?? [];
  },
  async listSubjects(): Promise<Subject[]> {
    const { data } = await axiosClient.get('/grade-school/subjects');
    return data.subjects ?? [];
  },
  async createSubject(body: { code: string; name: string }): Promise<Subject> {
    const { data } = await axiosClient.post('/grade-school/subjects', body);
    return data.subject;
  },
  async updateSubject(id: string, body: { code?: string; name?: string; isActive?: boolean }): Promise<Subject> {
    const { data } = await axiosClient.patch(`/grade-school/subjects/${id}`, body);
    return data.subject;
  },
  async deleteSubject(id: string): Promise<void> {
    await axiosClient.delete(`/grade-school/subjects/${id}`);
  },
  async setSubjectGrades(id: string, gradeLevelIds: string[]): Promise<void> {
    await axiosClient.put(`/grade-school/subjects/${id}/grades`, { gradeLevelIds });
  },
};

export const teacherName = (t: Teacher) =>
  [t.title, t.first_name, t.last_name].filter(Boolean).join(' ');

export const studentName = (s: ClassStudent) =>
  [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
