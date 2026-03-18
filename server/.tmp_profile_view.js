const sql = require('mssql');
const cfg = require('./src/config/db.config');

(async () => {
  const pool = await sql.connect(cfg);
  const cols = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='vw_UserCurrentProfile' ORDER BY ORDINAL_POSITION");
  console.log('[vw_UserCurrentProfile] ' + cols.recordset.map(x=>x.COLUMN_NAME).join(', '));
  const sample = await pool.request().query("SELECT TOP 3 * FROM dbo.vw_UserCurrentProfile");
  console.log(JSON.stringify(sample.recordset, null, 2));
  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
