import { Request } from 'express'

declare global {
  namespace Express {
    interface User {
      id?: string
      email?: string
      full_name?: string
      role?: string
      platform?: 'school' | 'corporate'
      userId?: string
      platformId?: string
      roleId?: string
    }
  }
}

export interface ExtendedRequest extends Request {
  platformId?: string
  tenantId?: string
}
