export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  limit: number
}

export interface AuthRequest {
  email: string
  password: string
}

export interface AuthResponse {
  user: {
    id: string
    email: string
    full_name: string
    role: string
    platform: 'school' | 'corporate'
  }
  token: string
}

// ===========================
// REGISTRATION REQUEST TYPES
// ===========================

export interface RegisterRequest {
  platform: 'school' | 'corporate'
  email: string
  fullName: string
  password: string
  confirmPassword: string
  phone?: string
  role: 'student' | 'faculty' | 'it' | 'employee' | 'hr' // Role selection during registration
  entityId?: string // school_entities.id or corporate_entities.id
}

export interface RegisterResponse {
  user: {
    id: string
    email: string
    full_name: string
    role: string
    platform: 'school' | 'corporate'
    requiresApproval: boolean
    status: 'active' | 'pending_approval'
  }
  message: string
  nextSteps?: string
}

export interface AdminApprovalRequest {
  registrationId: string
  action: 'approve' | 'reject'
  rejectionReason?: string
}

export interface AdminApprovalResponse {
  success: boolean
  message: string
  user?: {
    id: string
    email: string
    full_name: string
    role: string
    status: 'active' | 'rejected'
  }
}

export interface PendingApprovalsResponse {
  school?: Array<{
    id: string
    user: {
      id: string
      email: string
      full_name: string
    }
    requested_role: 'faculty' | 'it'
    school_entity: {
      id: string
      name: string
    }
    requested_at: Date
  }>
  corporate?: Array<{
    id: string
    user: {
      id: string
      email: string
      full_name: string
    }
    requested_role: 'it' | 'hr'
    corporate_entity: {
      id: string
      name: string
    }
    requested_at: Date
  }>
}
