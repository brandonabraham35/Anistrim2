// controllers/adminController.js
const db = require('../config/db');
const bcrypt = require('bcryptjs');

// ─── USERS ────────────────────────────────────────────────
// GET /api/admin/users
exports.getAllUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, is_premium, is_admin, premium_expires_at, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ total: rows.length, users: rows });
  } catch (err) {
    res.status(500).json({ message: 'Could not retrieve users.' });
  }
};

// PUT /api/admin/users/:id/premium
exports.togglePremium = async (req, res) => {
  const { id } = req.params;
  const { isPremium } = req.body;
  try {
    const expiresAt = isPremium ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
    await db.query('UPDATE users SET is_premium = ?, premium_expires_at = ? WHERE id = ?', [isPremium ? 1 : 0, expiresAt, id]);
    await logAdminAction(req.user.id, `Set premium=${isPremium}`, 'user', id);
    res.json({ message: `Premium ${isPremium ? 'granted' : 'revoked'}.` });
  } catch (err) {
    res.status(500).json({ message: 'Update failed.' });
  }
};

// ─── ANIME CMS ────────────────────────────────────────────
// GET /api/admin/anime
exports.getAllAnime = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, cover_image, rating, year, status, is_premium, is_featured, view_count, created_at
       FROM anime ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch anime list.' });
  }
};

// POST /api/admin/anime
exports.createAnime = async (req, res) => {
  const { title, title_japanese, description, cover_image, banner_image, rating, year, studio, status, is_premium, is_featured, genres } = req.body;
  if (!title) return res.status(400).json({ message: 'Title is required.' });
  try {
    const [result] = await db.query(
      `INSERT INTO anime (title, title_japanese, description, cover_image, banner_image, rating, year, studio, status, is_premium, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, title_japanese || null, description || null, cover_image || null, banner_image || null,
        rating || 0, year || null, studio || null, status || 'completed',
        is_premium ? 1 : 0, is_featured ? 1 : 0]
    );
    const animeId = result.insertId;

    // Link genres
    if (genres && genres.length) {
      const [genreRows] = await db.query('SELECT id, name FROM genres WHERE name IN (?)', [genres]);
      if (genreRows.length) {
        const values = genreRows.map(g => [animeId, g.id]);
        await db.query('INSERT IGNORE INTO anime_genres (anime_id, genre_id) VALUES ?', [values]);
      }
    }

    await logAdminAction(req.user.id, `Created anime: ${title}`, 'anime', animeId);
    res.status(201).json({ message: 'Anime created!', id: animeId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create anime.' });
  }
};

// PUT /api/admin/anime/:id
exports.updateAnime = async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const allowed = ['title', 'title_japanese', 'description', 'cover_image', 'banner_image', 'rating', 'year', 'studio', 'status', 'is_premium', 'is_featured'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ message: 'No valid fields to update.' });

  try {
    const sql = `UPDATE anime SET ${updates.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    await db.query(sql, [...updates.map(k => fields[k]), id]);
    await logAdminAction(req.user.id, `Updated anime id=${id}`, 'anime', parseInt(id));
    res.json({ message: 'Anime updated.' });
  } catch (err) {
    res.status(500).json({ message: 'Update failed.' });
  }
};

// DELETE /api/admin/anime/:id
exports.deleteAnime = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT title FROM anime WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Anime not found.' });
    await db.query('DELETE FROM anime WHERE id = ?', [id]);
    await logAdminAction(req.user.id, `Deleted anime: ${rows[0].title}`, 'anime', parseInt(id));
    res.json({ message: `Deleted: ${rows[0].title}` });
  } catch (err) {
    res.status(500).json({ message: 'Delete failed.' });
  }
};

// ─── EPISODES CMS ─────────────────────────────────────────
// POST /api/admin/anime/:animeId/episodes
exports.addEpisode = async (req, res) => {
  const { animeId } = req.params;
  const { episode_number, title, description, video_url, thumbnail_url, duration_sec, is_premium } = req.body;
  if (!episode_number) return res.status(400).json({ message: 'episode_number required.' });
  try {
    await db.query(
      `INSERT INTO episodes (anime_id, episode_number, title, description, video_url, thumbnail_url, duration_sec, is_premium)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [animeId, episode_number, title || `Episode ${episode_number}`, description || null,
        video_url || null, thumbnail_url || null, duration_sec || 1440, is_premium ? 1 : 0]
    );
    res.status(201).json({ message: 'Episode added.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: `Episode ${episode_number} already exists for this anime.` });
    res.status(500).json({ message: 'Failed to add episode.' });
  }
};

// PUT /api/admin/episodes/:id
exports.updateEpisode = async (req, res) => {
  const { id } = req.params;
  const {
    video_url, title, duration_sec, is_premium,
    thumbnail_url, episode_number,
    intro_start_time, intro_end_time,
    // also accept camelCase from admin form
    introStartTime, introEndTime,
  } = req.body;

  const introStart = intro_start_time != null ? intro_start_time : (introStartTime != null ? introStartTime : undefined);
  const introEnd = intro_end_time != null ? intro_end_time : (introEndTime != null ? introEndTime : undefined);

  try {
    await db.query(
      `UPDATE episodes SET
        video_url        = COALESCE(?, video_url),
        title            = COALESCE(?, title),
        duration_sec     = COALESCE(?, duration_sec),
        is_premium       = COALESCE(?, is_premium),
        thumbnail_url    = COALESCE(?, thumbnail_url),
        episode_number   = COALESCE(?, episode_number),
        intro_start_time = ?,
        intro_end_time   = ?
       WHERE id = ?`,
      [
        video_url || null,
        title || null,
        duration_sec || null,
        is_premium != null ? (is_premium ? 1 : 0) : null,
        thumbnail_url || null,
        episode_number || null,
        introStart != null ? parseInt(introStart) : null,
        introEnd != null ? parseInt(introEnd) : null,
        id,
      ]
    );
    await logAdminAction(req.user.id, `Updated episode id=${id}`, 'episode', parseInt(id));
    res.json({ message: 'Episode updated.' });
  } catch (err) {
    console.error('updateEpisode error:', err.message);
    res.status(500).json({ message: 'Update failed.' });
  }
};

// DELETE /api/admin/episodes/:id
exports.deleteEpisode = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query('DELETE FROM episodes WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Episode not found.' });
    }
    await logAdminAction(req.user.id, 'Deleted episode', 'episode', id);
    res.json({ message: 'Episode deleted.' });
  } catch (err) {
    console.error('deleteEpisode error:', err);
    res.status(500).json({ message: 'Failed to delete episode.' });
  }
};


// ─── ANALYTICS ────────────────────────────────────────────
// GET /api/admin/stats
exports.getDashboardStats = async (req, res) => {
  try {
    const [[userStats]] = await db.query(`SELECT COUNT(*) AS total, SUM(is_premium) AS premium FROM users`);
    const [[animeStats]] = await db.query(`SELECT COUNT(*) AS total, SUM(view_count) AS views FROM anime`);
    const [[revenue]] = await db.query(`SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN DATE(paid_at)=CURDATE() THEN amount END),0) AS today FROM payments WHERE status='successful'`);
    const [recentUsers] = await db.query(`SELECT id, name, email, is_premium, created_at FROM users ORDER BY created_at DESC LIMIT 5`);
    const [topAnime] = await db.query(`SELECT id, title, view_count FROM anime ORDER BY view_count DESC LIMIT 5`);

    res.json({
      users: { total: userStats.total, premium: userStats.premium },
      anime: { total: animeStats.total, totalViews: animeStats.views },
      revenue: { total: revenue.total, today: revenue.today },
      recentUsers,
      topAnime,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch stats.' });
  }
};

// ─── HELPER ───────────────────────────────────────────────
async function logAdminAction(adminId, action, targetType, targetId) {
  try {
    await db.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
      [adminId, action, targetType, targetId || null]
    );
  } catch (_) { }
}
