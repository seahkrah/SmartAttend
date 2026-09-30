/** Mints a superadmin access token for manual probing of the control plane. */
import { query } from '../db/connection.js'
import { issueTokens } from '../auth/authService.js'
const generateAccessToken = async (id: string, platform_id: string, role_id: string) =>
  (await issueTokens({ id, platform_id, role_id }, { userAgent: 'e2e fixture' })).accessToken

const r = await query(
  `SELECT u.id, u.platform_id, u.role_id FROM users u
     JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'superadmin' LIMIT 1`
)
if (r.rows.length === 0) {
  console.error('no superadmin account in this database')
  process.exit(1)
}
const u = r.rows[0]
console.log(await generateAccessToken(u.id, u.platform_id, u.role_id))
process.exit(0)
