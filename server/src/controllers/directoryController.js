// src/controllers/directoryController.js
const { searchDirectory } = require('../utils/phoneDirectory');

// GET /api/directory/search?q=...&limit=20
exports.search = async (req, res) => {
  try {
    const { q, limit } = req.query;
    const parsedLimit = Number.isInteger(parseInt(limit)) ? parseInt(limit) : 20;
    const safeLimit = Math.min(Math.max(parsedLimit, 1), 50);
    const entries = await searchDirectory(q, safeLimit);
    res.status(200).json(entries);
  } catch (error) {
    console.error('Error searching phone directory:', error);
    res.status(500).json({ message: 'خطأ في البحث بدليل الهاتف', detail: error.message });
  }
};
