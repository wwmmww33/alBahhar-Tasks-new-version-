const sql = require('mssql');
const cfg = require('./src/config/db.config');

(async () => {
  const p = await sql.connect(cfg);
  const q = `
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo'
      AND TABLE_NAME IN ('Tasks','Subtasks','TaskViews','TaskAssignmentNotifications','CommentNotifications','TaskDelegations','UserTaskPriorities')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `;
  const r = await p.request().query(q);
  console.log(JSON.stringify(r.recordset, null, 2));
  await p.close();
})().catch(e => { console.error(e.message); process.exit(1); });
