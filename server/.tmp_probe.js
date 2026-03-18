const sql = require('mssql');
const cfg = require('./src/config/db.config');
(async()=>{
  const p = await sql.connect(cfg);
  const r = await p.request().query(`
    SELECT
      COL_LENGTH('dbo.Tasks', 'AssignedToVacancyID') AS TAssignVac,
      COL_LENGTH('dbo.Tasks', 'AssignedTo') AS TAssignUser,
      COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') AS SAssignVac,
      COL_LENGTH('dbo.Subtasks', 'AssignedTo') AS SAssignUser
  `);
  console.log(r.recordset[0]);
  await p.close();
})().catch(e=>{console.error(e); process.exit(1);});
