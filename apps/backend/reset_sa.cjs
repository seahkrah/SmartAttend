const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function main() {
  const hash = await bcrypt.hash('SuperAdmin123!', 12);
  const c = new Client({ connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend' });
  await c.connect();
  const r = await c.query('UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email, full_name', [hash, 'superadmin@smartattend.local']);
  console.log('Updated:', r.rows[0]);
  await c.end();
}

main().catch(console.error);
