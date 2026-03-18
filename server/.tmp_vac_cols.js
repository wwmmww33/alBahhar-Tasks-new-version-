const sql = require('mssql');
const cfg = require('./src/config/db.config');

(async () => {
  const pool = await sql.connect(cfg);
  const q = `
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND (COLUMN_NAME LIKE '%Vacancy%' OR TABLE_NAME LIKE '%Vacanc%')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `;
  const r = await pool.request().query(q);
  for (const row of r.recordset) console.log(`${row.TABLE_NAME}.${row.COLUMN_NAME}`);
  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
