import { query } from './src/db/connection.js'
import { hashPassword } from './src/auth/authService.js'

async function setupSuperadmin() {
  try {
    console.log('🔧 Setting up superadmin system...')

    // 1. Ensure system platform exists
    console.log('📍 Creating system platform...')
    const platformResult = await query(
      `INSERT INTO platforms (name, display_name)
       VALUES ('system', 'System Management')
       ON CONFLICT (name) DO NOTHING
       RETURNING id`
    )

    let systemPlatformId = platformResult.rows[0]?.id
    if (!systemPlatformId) {
      const existing = await query(`SELECT id FROM platforms WHERE name = 'system'`)
      systemPlatformId = existing.rows[0].id
    }

    console.log(`✅ System platform ID: ${systemPlatformId}`)

    // 2. Create superadmin role
    console.log('📍 Creating superadmin role...')
    const roleResult = await query(
      `INSERT INTO roles (platform_id, name, description, permissions)
       VALUES ($1, 'superadmin', 'Superadmin - Full Platform Access', $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        systemPlatformId,
        JSON.stringify([
          'manage_all_entities',
          'manage_all_users',
          'view_all_data',
          'view_all_approvals',
          'approve_all_requests',
          'manage_roles',
          'view_audit_logs',
          'system_settings',
          'view_analytics',
          'manage_platforms'
        ])
      ]
    )

    let superadminRoleId = roleResult.rows[0]?.id
    if (!superadminRoleId) {
      const existing = await query(
        `SELECT id FROM roles WHERE name = 'superadmin' AND platform_id = $1`,
        [systemPlatformId]
      )
      superadminRoleId = existing.rows[0].id
    }

    console.log(`✅ Superadmin role ID: ${superadminRoleId}`)

    // 3. Create audit logging table
    console.log('📍 Creating audit logging tables...')
    await query(`
      CREATE TABLE IF NOT EXISTS superadmin_action_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(255) NOT NULL,
        entity_type VARCHAR(100),
        entity_id UUID,
        details JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('✅ Audit logging tables created')

    // 4. Create superadmin statistics table
    console.log('📍 Creating statistics table...')
    await query(`
      CREATE TABLE IF NOT EXISTS superadmin_statistics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        metric_name VARCHAR(255) NOT NULL,
        metric_value INTEGER DEFAULT 0,
        metric_data JSONB,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(metric_name)
      )
    `)
    console.log('✅ Statistics table created')

    // 5. Hash password
    console.log('📍 Hashing password...')
    const hashedPassword = await hashPassword('smartattend123')

    // 6. Create or update superadmin user
    console.log('📍 Creating superadmin user...')
    const userResult = await query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (platform_id, email) DO UPDATE
       SET password_hash = $5, is_active = true, updated_at = CURRENT_TIMESTAMP
       RETURNING id, email`,
      [systemPlatformId, 'superadmin@smartattend.local', 'System Superadmin', superadminRoleId, hashedPassword]
    )

    const superadminUser = userResult.rows[0]
    console.log(`✅ Superadmin user created/updated: ${superadminUser.email}`)

    // 7. Create indexes
    console.log('📍 Creating indexes...')
    await query(`
      CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_superadmin_user_id 
      ON superadmin_action_logs(superadmin_user_id);
      CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_action 
      ON superadmin_action_logs(action);
      CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_created_at 
      ON superadmin_action_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_superadmin_statistics_metric_name 
      ON superadmin_statistics(metric_name)
    `)
    console.log('✅ Indexes created')

    // 8. Create views
    console.log('📍 Creating views...')
    
    try {
      await query(`
        CREATE OR REPLACE VIEW superadmin_entities_summary AS
        SELECT 
          'school' AS entity_type,
          CAST(COUNT(*) AS INTEGER) AS total_count,
          SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_count
        FROM school_entities
        UNION ALL
        SELECT 
          'corporate' AS entity_type,
          CAST(COUNT(*) AS INTEGER) AS total_count,
          SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_count
        FROM corporate_entities
      `)

      await query(`
        CREATE OR REPLACE VIEW superadmin_all_pending_approvals AS
        SELECT 
          sau.id,
          'school' AS entity_type,
          se.name AS entity_name,
          se.id AS entity_id,
          u.full_name AS user_name,
          u.email AS user_email,
          sau.requested_role AS role,
          sau.requested_at AS requested_at,
          'school_user_approvals' AS table_name
        FROM school_user_approvals sau
        JOIN users u ON sau.user_id = u.id
        JOIN school_entities se ON sau.school_entity_id = se.id
        WHERE sau.status = 'pending'
        UNION ALL
        SELECT 
          cau.id,
          'corporate' AS entity_type,
          ce.name AS entity_name,
          ce.id AS entity_id,
          u.full_name AS user_name,
          u.email AS user_email,
          cau.requested_role AS role,
          cau.requested_at AS requested_at,
          'corporate_user_approvals' AS table_name
        FROM corporate_user_approvals cau
        JOIN users u ON cau.user_id = u.id
        JOIN corporate_entities ce ON cau.corporate_entity_id = ce.id
        WHERE cau.status = 'pending'
        ORDER BY requested_at DESC
      `)

      await query(`
        CREATE OR REPLACE VIEW superadmin_user_statistics AS
        SELECT 
          p.id AS platform_id,
          p.name AS platform_name,
          COUNT(DISTINCT u.id) AS total_users,
          SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END) AS active_users,
          COUNT(DISTINCT CASE WHEN r.name = 'admin' THEN u.id END) AS admin_count,
          COUNT(DISTINCT CASE WHEN r.name = 'student' THEN u.id END) AS student_count,
          COUNT(DISTINCT CASE WHEN r.name = 'faculty' THEN u.id END) AS faculty_count,
          COUNT(DISTINCT CASE WHEN r.name = 'employee' THEN u.id END) AS employee_count,
          COUNT(DISTINCT CASE WHEN r.name = 'it' THEN u.id END) AS it_count,
          COUNT(DISTINCT CASE WHEN r.name = 'hr' THEN u.id END) AS hr_count
        FROM platforms p
        LEFT JOIN users u ON p.id = u.platform_id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE p.name != 'system'
        GROUP BY p.id, p.name
      `)

      console.log('✅ Views created')
    } catch (viewError: any) {
      console.warn('⚠️  Note: Some views could not be created (tables may not exist yet)')
      console.warn(`   Error: ${viewError.message.split('\n')[0]}`)
    }

    console.log('\n✅ Superadmin setup completed successfully!')
    console.log('\n📝 Default Credentials:')
    console.log('   Email: superadmin@smartattend.local')
    console.log('   Password: smartattend123')
    console.log('\n⚠️  IMPORTANT: Change the default password immediately in production!')

    process.exit(0)
  } catch (error) {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  }
}

setupSuperadmin()
