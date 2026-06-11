// routes/adminRoutes.js
const express = require('express');
const router  = express.Router();
const admin   = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect, adminOnly);

// Dashboard
router.get('/stats',                        admin.getDashboardStats);

// Users
router.get('/users',                        admin.getAllUsers);
router.put('/users/:id/premium',            admin.togglePremium);

// Anime CMS
router.get('/anime',                        admin.getAllAnime);
router.post('/anime',                       admin.createAnime);
router.put('/anime/:id',                    admin.updateAnime);
router.delete('/anime/:id',                 admin.deleteAnime);

// Episodes
router.post('/anime/:animeId/episodes',     admin.addEpisode);
router.put('/episodes/:id',                 admin.updateEpisode);
router.delete('/episodes/:id',              admin.deleteEpisode);

module.exports = router;
