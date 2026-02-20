const { Client } = require('pg');
const c = new Client('postgresql://smartattend_user:smartattend_password@localhost:5432/smartattend_db');
c.connect()
  .then(() => c.query("SELECT column_name FROM information_schema.columns WHERE table_name='faculty' ORDER BY ordinal_position"))
  .then(r => { r.rows.forEach(x => console.log(x.column_name)); c.end(); })
  .catch(e => { console.log('ERR:', e.message); c.end(); });
