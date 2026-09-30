import { axiosClient } from '../utils/axiosClient';
import type { SchoolFeature, SchoolShape } from '../navigation/navConfig';

/**
 * School types: what kind of school a tenant is and the levels it offers.
 *
 * The catalogue lives on the server (services/schoolTypes.ts); nothing here
 * repeats it. A school's own people read their structure, and a superadmin
 * reads the catalogue to create or change a school.
 */

export type SchoolType = 'grade_school' | 'vocational' | 'college' | 'university';

export interface SchoolStage {
  key: string;
  label: string;
  grades?: Array<{ code: string; name: string }>;
}

export interface SchoolTypeDef extends SchoolShape {
  key: SchoolType;
  label: string;
  description: string;
  stages: SchoolStage[];
}

export interface GradeLevel {
  id: string;
  stage: string;
  code: string;
  name: string;
}

export interface SchoolStructure extends SchoolShape {
  type: SchoolType;
  label: string;
  stages: Array<{ key: string; label: string; offered: boolean }>;
  features: Record<SchoolFeature, boolean>;
  gradeLevels: GradeLevel[];
}

export const schoolTypesService = {
  /** The signed-in person's school. */
  async getStructure(): Promise<SchoolStructure> {
    const { data } = await axiosClient.get('/academics/structure');
    return data;
  },

  /** Superadmin: every type a school can be created as. */
  async listTypes(): Promise<SchoolTypeDef[]> {
    const { data } = await axiosClient.get('/superadmin/school-types');
    return data.types ?? [];
  },
};
