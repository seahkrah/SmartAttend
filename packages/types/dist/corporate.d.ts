/**
 * Corporate Platform Types
 */
export interface Employee {
    id: string;
    employeeId: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    email: string;
    departmentId: string;
    jobTitle: string;
    reportingManager?: string;
    phone?: string;
    profileImage?: string | null;
    joinDate: string;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}
export interface EmployeeCreateRequest {
    userId: string;
    employeeId: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    email: string;
    departmentId: string;
    jobTitle: string;
    reportingManager?: string;
    phone?: string;
    joinDate: string;
}
export interface EmployeeUpdateRequest {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    departmentId?: string;
    jobTitle?: string;
    reportingManager?: string;
    phone?: string;
    isActive?: boolean;
}
export interface EmployeeListResponse {
    data: Employee[];
    total: number;
    limit: number;
    offset: number;
}
export interface CorporateDepartment {
    id: string;
    name: string;
    code: string;
    description?: string;
    headId?: string;
    createdAt?: string;
}
export interface Team {
    id: string;
    name: string;
    departmentId: string;
    managerId: string;
    description?: string;
    createdAt?: string;
}
//# sourceMappingURL=corporate.d.ts.map