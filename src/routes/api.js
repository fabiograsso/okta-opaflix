/**
 * API Routes
 *
 * Handles API endpoints for fetching data from external services.
 */

const express = require('express');
const { ensureAuthenticated } = require('../middleware/authentication');
const { listRateLimiter } = require('../middleware/rateLimiter');
const { getFilterOptions, refreshSessions, refreshGraph, getRefreshStatus } = require('../controllers/apiController');

/**
 * Create API routes
 * @returns {express.Router} Express router with API routes
 */
function createApiRoutes() {
  const router = express.Router();

  // All API routes require authentication
  router.use(ensureAuthenticated);

  // OPA API endpoints
  router.get('/opa/filter-options', listRateLimiter, getFilterOptions);

  // Cache refresh endpoints
  router.get('/refresh/status', listRateLimiter, getRefreshStatus);
  router.post('/refresh/sessions', listRateLimiter, refreshSessions);
  router.post('/refresh/graph', listRateLimiter, refreshGraph);

  return router;
}

module.exports = { createApiRoutes };
