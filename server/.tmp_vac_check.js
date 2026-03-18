const sql = require('mssql');
const cfg = require('./src/config/db.config');
(async()=>{
  const p = await sql.connect(cfg);
  const cols = await p.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='JobVacancies' ORDER BY ORDINAL_POSITION");
  console.log(cols.recordset.map(r=>r.COLUMN_NAME).join(','));
  const sample = await p.request().query("SELECT TOP 5 VacancyID, Name, DepartmentID FROM dbo.JobVacancies ORDER BY VacancyID");
  console.log(JSON.stringify(sample.recordset));
  await p.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
