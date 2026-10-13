/**
 * @file api.js
 * @description Scalable master router combining modular merchant, user, admin, and system routes.
 */

const express = require('express');
const router = express.Router();

const merchantRoutes = require('./merchantRoutes');
const userRoutes = require('./userRoutes');
const adminRoutes = require('./adminRoutes');
const systemRoutes = require('./systemRoutes');

router.use('/merchant', merchantRoutes);
router.use('/user', userRoutes);
router.use('/admin', adminRoutes);
router.use('/', systemRoutes);

module.exports = router;
