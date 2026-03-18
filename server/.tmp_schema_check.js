const sql = require('mssql');
const cfg = require('./src/config/db.config');

(async () => {
  const pool = await sql.connect(cfg);
  const tables = ['TaskDelegations','TaskAssignmentNotifications','TaskViews','Subtasks','CommentNotifications'];
  for (const t of tables) {
    const q = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`;
    const r = await pool.request().query(q);
    console.log(`[${t}] ${r.recordset.map(x => x.COLUMN_NAME).join(', ')}`);
  }
  await pool.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
