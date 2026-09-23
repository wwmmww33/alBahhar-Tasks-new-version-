// src/controllers/announcementsController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');

const resolveActingUserId = (req) => {
  return String(
    req.body?.UserID ||
    req.body?.userId ||
    req.query?.userId ||
    req.headers['user-id'] ||
    ''
  ).trim();
};

const resolveIsAdmin = (req) =>
  req.body?.isAdmin === true || req.body?.isAdmin === 'true' || req.query?.isAdmin === 'true';

const decryptRow = (row) => {
  try { if (row.Title) row.Title = encryptionConfig.decrypt(row.Title); } catch (_) {}
  try { if (row.Body) row.Body = encryptionConfig.decrypt(row.Body); } catch (_) {}
  return row;
};

// GET /api/announcements?userId=...  — قائمة كل التحديثات النشطة، مع علامة IsRead لكل مستخدم
exports.getAnnouncements = async (req, res) => {
  const pool = req.app.locals.db;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    const result = await pool.request()
      .input('UserID', sql.NVarChar, userId)
      .query(`
        SELECT
          a.AnnouncementID, a.Title, a.Body, a.CreatedByName, a.CreatedAt, a.UpdatedAt,
          CASE WHEN r.ReadID IS NOT NULL THEN 1 ELSE 0 END AS IsRead
        FROM dbo.Announcements a
        LEFT JOIN dbo.AnnouncementReads r ON r.AnnouncementID = a.AnnouncementID AND r.UserID = @UserID
        WHERE a.IsActive = 1
        ORDER BY a.CreatedAt DESC
      `);
    res.status(200).json(result.recordset.map(decryptRow));
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ message: 'خطأ في جلب تحديثات النظام', detail: error.message });
  }
};

// GET /api/announcements/unread-count?userId=...
exports.getUnreadCount = async (req, res) => {
  const pool = req.app.locals.db;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    const result = await pool.request()
      .input('UserID', sql.NVarChar, userId)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.Announcements a
        WHERE a.IsActive = 1
          AND NOT EXISTS (
            SELECT 1 FROM dbo.AnnouncementReads r
            WHERE r.AnnouncementID = a.AnnouncementID AND r.UserID = @UserID
          )
      `);
    res.status(200).json({ unreadCount: result.recordset[0]?.cnt || 0 });
  } catch (error) {
    console.error('Error fetching announcements unread count:', error);
    res.status(500).json({ message: 'خطأ في جلب عدد التحديثات غير المقروءة', detail: error.message });
  }
};

// POST /api/announcements/:id/read  { userId }
exports.markAsRead = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    await pool.request()
      .input('AnnouncementID', sql.Int, parseInt(id, 10))
      .input('UserID', sql.NVarChar, userId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.AnnouncementReads WHERE AnnouncementID = @AnnouncementID AND UserID = @UserID
        )
        INSERT INTO dbo.AnnouncementReads (AnnouncementID, UserID) VALUES (@AnnouncementID, @UserID);
      `);
    res.status(200).json({ message: 'تم التحديد كمقروء' });
  } catch (error) {
    console.error('Error marking announcement as read:', error);
    res.status(500).json({ message: 'خطأ في تحديث حالة القراءة', detail: error.message });
  }
};

// POST /api/announcements/mark-all-read  { userId }
exports.markAllAsRead = async (req, res) => {
  const pool = req.app.locals.db;
  const userId = resolveActingUserId(req);
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    await pool.request()
      .input('UserID', sql.NVarChar, userId)
      .query(`
        INSERT INTO dbo.AnnouncementReads (AnnouncementID, UserID)
        SELECT a.AnnouncementID, @UserID
        FROM dbo.Announcements a
        WHERE a.IsActive = 1
          AND NOT EXISTS (
            SELECT 1 FROM dbo.AnnouncementReads r
            WHERE r.AnnouncementID = a.AnnouncementID AND r.UserID = @UserID
          );
      `);
    res.status(200).json({ message: 'تم تحديد الكل كمقروء' });
  } catch (error) {
    console.error('Error marking all announcements as read:', error);
    res.status(500).json({ message: 'خطأ في تحديث حالة القراءة', detail: error.message });
  }
};

// POST /api/announcements  { Title, Body, userId, isAdmin, FullName }  — للمدير فقط
exports.createAnnouncement = async (req, res) => {
  const pool = req.app.locals.db;
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة لنشر تحديث جديد.' });
  }
  const userId = resolveActingUserId(req);
  const { Title, Body, FullName } = req.body;
  if (!userId || !Title || !Body) {
    return res.status(400).json({ message: 'Title, Body, and userId are required.' });
  }

  try {
    const result = await pool.request()
      .input('Title', sql.NVarChar, encryptionConfig.encrypt(Title))
      .input('Body', sql.NVarChar, encryptionConfig.encrypt(Body))
      .input('CreatedByUserID', sql.NVarChar, userId)
      .input('CreatedByName', sql.NVarChar, FullName || null)
      .query(`
        INSERT INTO dbo.Announcements (Title, Body, CreatedByUserID, CreatedByName)
        OUTPUT INSERTED.AnnouncementID, INSERTED.Title, INSERTED.Body, INSERTED.CreatedByName, INSERTED.CreatedAt, INSERTED.UpdatedAt
        VALUES (@Title, @Body, @CreatedByUserID, @CreatedByName);
      `);
    const created = decryptRow(result.recordset[0]);
    res.status(201).json({ ...created, IsRead: 0 });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ message: 'خطأ في إنشاء التحديث', detail: error.message });
  }
};

// PUT /api/announcements/:id  { Title, Body, userId, isAdmin }  — للمدير فقط
exports.updateAnnouncement = async (req, res) => {
  const pool = req.app.locals.db;
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة لتعديل التحديث.' });
  }
  const { id } = req.params;
  const { Title, Body } = req.body;
  if (!Title && !Body) {
    return res.status(400).json({ message: 'Nothing to update' });
  }

  try {
    const request = pool.request().input('AnnouncementID', sql.Int, parseInt(id, 10));
    const setParts = ['UpdatedAt = GETDATE()'];
    if (Title) { request.input('Title', sql.NVarChar, encryptionConfig.encrypt(Title)); setParts.push('Title = @Title'); }
    if (Body) { request.input('Body', sql.NVarChar, encryptionConfig.encrypt(Body)); setParts.push('Body = @Body'); }

    const result = await request.query(`
      UPDATE dbo.Announcements SET ${setParts.join(', ')} WHERE AnnouncementID = @AnnouncementID;
      SELECT AnnouncementID, Title, Body, CreatedByName, CreatedAt, UpdatedAt FROM dbo.Announcements WHERE AnnouncementID = @AnnouncementID;
    `);
    if (!result.recordset.length) return res.status(404).json({ message: 'التحديث غير موجود' });
    res.status(200).json(decryptRow(result.recordset[0]));
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ message: 'خطأ في تعديل التحديث', detail: error.message });
  }
};

// DELETE /api/announcements/:id?userId=...&isAdmin=true  — للمدير فقط
exports.deleteAnnouncement = async (req, res) => {
  const pool = req.app.locals.db;
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة لحذف التحديث.' });
  }
  const { id } = req.params;

  try {
    const result = await pool.request()
      .input('AnnouncementID', sql.Int, parseInt(id, 10))
      .query(`
        DELETE FROM dbo.Announcements WHERE AnnouncementID = @AnnouncementID;
        SELECT @@ROWCOUNT AS affected;
      `);
    if (!result.recordset[0]?.affected) return res.status(404).json({ message: 'التحديث غير موجود' });
    res.status(200).json({ message: 'تم حذف التحديث' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ message: 'خطأ في حذف التحديث', detail: error.message });
  }
};
