// src/controllers/proposalsController.js
// مقترحات تطوير النظام: يقدّمها أي مستخدم، ويراجعها المدير العام فقط من تبويب "إدارة النظام".
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { isTrueSystemAdmin } = require('../utils/departmentSharing');

const resolveActingUserId = (req) => {
  return String(
    req.body?.UserID ||
    req.body?.userId ||
    req.query?.userId ||
    req.headers['user-id'] ||
    ''
  ).trim();
};

const decryptRow = (row) => {
  try { if (row.Title) row.Title = encryptionConfig.decrypt(row.Title); } catch (_) {}
  try { if (row.Description) row.Description = encryptionConfig.decrypt(row.Description); } catch (_) {}
  return row;
};

const VALID_STATUSES = ['pending', 'under_review', 'accepted', 'rejected', 'implemented'];

// POST /api/proposals  { Title, Description, userId, FullName }  — أي مستخدم مسجَّل
exports.createProposal = async (req, res) => {
  const pool = req.app.locals.db;
  const userId = resolveActingUserId(req);
  const { Title, Description, FullName } = req.body || {};
  if (!userId) return res.status(401).json({ message: 'userId is required.' });
  if (!Title || !String(Title).trim() || !Description || !String(Description).trim()) {
    return res.status(400).json({ message: 'العنوان والوصف مطلوبان.' });
  }

  try {
    const result = await pool.request()
      .input('Title', sql.NVarChar, encryptionConfig.encrypt(String(Title).trim()))
      .input('Description', sql.NVarChar(sql.MAX), encryptionConfig.encrypt(String(Description).trim()))
      .input('CreatedByUserID', sql.NVarChar, userId)
      .input('CreatedByName', sql.NVarChar, FullName || null)
      .query(`
        INSERT INTO dbo.SystemProposals (Title, Description, CreatedByUserID, CreatedByName)
        OUTPUT INSERTED.ProposalID, INSERTED.Title, INSERTED.Description, INSERTED.CreatedByName,
               INSERTED.Status, INSERTED.CreatedAt
        VALUES (@Title, @Description, @CreatedByUserID, @CreatedByName);
      `);
    res.status(201).json(decryptRow(result.recordset[0]));
  } catch (error) {
    console.error('CREATE PROPOSAL ERROR:', error);
    res.status(500).json({ message: 'خطأ في إرسال المقترح', detail: error.message });
  }
};

// GET /api/proposals?userId=  — المدير العام للنظام فقط (Role=1)
exports.getProposals = async (req, res) => {
  const pool = req.app.locals.db;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(401).json({ message: 'userId is required.' });

  try {
    const allowed = await isTrueSystemAdmin(pool, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'هذه الصفحة متاحة للمدير العام للنظام فقط.' });
    }
    const result = await pool.request().query(`
      SELECT ProposalID, Title, Description, CreatedByUserID, CreatedByName, Status, AdminNotes, CreatedAt, UpdatedAt
      FROM dbo.SystemProposals
      ORDER BY CreatedAt DESC
    `);
    res.status(200).json(result.recordset.map(decryptRow));
  } catch (error) {
    console.error('GET PROPOSALS ERROR:', error);
    res.status(500).json({ message: 'خطأ في جلب المقترحات', detail: error.message });
  }
};

// PATCH /api/proposals/:id  { Status?, AdminNotes?, userId }  — المدير العام للنظام فقط
exports.updateProposal = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
  const userId = resolveActingUserId(req);
  const { Status, AdminNotes } = req.body || {};
  if (!userId) return res.status(401).json({ message: 'userId is required.' });
  if (typeof Status === 'undefined' && typeof AdminNotes === 'undefined') {
    return res.status(400).json({ message: 'Nothing to update.' });
  }
  if (typeof Status !== 'undefined' && !VALID_STATUSES.includes(Status)) {
    return res.status(400).json({ message: 'حالة غير صالحة.' });
  }

  try {
    const allowed = await isTrueSystemAdmin(pool, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'هذه الصفحة متاحة للمدير العام للنظام فقط.' });
    }

    const request = pool.request().input('ProposalID', sql.Int, parseInt(id, 10));
    const setParts = ['UpdatedAt = GETDATE()'];
    if (typeof Status !== 'undefined') {
      request.input('Status', sql.NVarChar, Status);
      setParts.push('Status = @Status');
    }
    if (typeof AdminNotes !== 'undefined') {
      request.input('AdminNotes', sql.NVarChar(sql.MAX), AdminNotes ? String(AdminNotes) : null);
      setParts.push('AdminNotes = @AdminNotes');
    }

    const result = await request.query(`
      UPDATE dbo.SystemProposals SET ${setParts.join(', ')} WHERE ProposalID = @ProposalID;
      SELECT ProposalID, Title, Description, CreatedByUserID, CreatedByName, Status, AdminNotes, CreatedAt, UpdatedAt
      FROM dbo.SystemProposals WHERE ProposalID = @ProposalID;
    `);
    if (!result.recordset.length) return res.status(404).json({ message: 'المقترح غير موجود.' });
    res.status(200).json(decryptRow(result.recordset[0]));
  } catch (error) {
    console.error('UPDATE PROPOSAL ERROR:', error);
    res.status(500).json({ message: 'خطأ في تحديث المقترح', detail: error.message });
  }
};

// DELETE /api/proposals/:id?userId=  — المدير العام للنظام فقط
exports.deleteProposal = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(401).json({ message: 'userId is required.' });

  try {
    const allowed = await isTrueSystemAdmin(pool, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'هذه الصفحة متاحة للمدير العام للنظام فقط.' });
    }
    const result = await pool.request()
      .input('ProposalID', sql.Int, parseInt(id, 10))
      .query(`
        DELETE FROM dbo.SystemProposals WHERE ProposalID = @ProposalID;
        SELECT @@ROWCOUNT AS affected;
      `);
    if (!result.recordset[0]?.affected) return res.status(404).json({ message: 'المقترح غير موجود.' });
    res.status(200).json({ message: 'تم حذف المقترح.' });
  } catch (error) {
    console.error('DELETE PROPOSAL ERROR:', error);
    res.status(500).json({ message: 'خطأ في حذف المقترح', detail: error.message });
  }
};
