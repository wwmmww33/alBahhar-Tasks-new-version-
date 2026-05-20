// src/controllers/ranksController.js
const sql = require('mssql');

async function probeRanksTable(pool) {
    const r = await pool.request().query(`
        SELECT
          CASE WHEN OBJECT_ID('dbo.Ranks','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable,
          CASE WHEN COL_LENGTH('dbo.Ranks','RankID')   IS NOT NULL THEN 1 ELSE 0 END AS HasRankID,
          CASE WHEN COL_LENGTH('dbo.Ranks','Name')     IS NOT NULL THEN 1 ELSE 0 END AS HasName,
          CASE WHEN COL_LENGTH('dbo.Ranks','RankName') IS NOT NULL THEN 1 ELSE 0 END AS HasRankName,
          CASE WHEN COL_LENGTH('dbo.Ranks','Level')    IS NOT NULL THEN 1 ELSE 0 END AS HasLevel,
          CASE WHEN COL_LENGTH('dbo.Ranks','OrderNum') IS NOT NULL THEN 1 ELSE 0 END AS HasOrderNum
    `);
    const s = r.recordset[0] || {};
    return {
        ...s,
        nameCol: s.HasName ? 'Name' : (s.HasRankName ? 'RankName' : null),
    };
}

// GET /api/ranks
exports.listRanks = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'DB unavailable' });
    try {
        const s = await probeRanksTable(pool);
        if (!s.HasTable || !s.nameCol) return res.status(200).json([]);
        const orderBy = s.HasOrderNum ? 'OrderNum' : (s.HasLevel ? 'Level' : (s.HasRankID ? 'RankID' : '(SELECT NULL)'));
        const result = await pool.request().query(
            `SELECT * FROM dbo.Ranks ORDER BY ${orderBy}`
        );
        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST RANKS ERROR:', err);
        res.status(500).json({ message: 'Error fetching ranks', detail: err.message });
    }
};
