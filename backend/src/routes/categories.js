import express from 'express';
import CategoriesController from '../controllers/categories.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorizeAdmin } from '../middlewares/authorizeAdmin.js';
import { sensitiveWriteRateLimiter } from '../middlewares/rateLimits.js';

const router = express.Router();
const controller = new CategoriesController();
const send = (res, result) => res.status(result.statusCode).send(result);

router.get('/admin', authenticate, authorizeAdmin, async (_req, res) =>
  send(res, await controller.listForAdmin()));
router.get('/', async (_req, res) => send(res, await controller.list()));
router.get('/:id', async (req, res) => send(res, await controller.get(req.params.id)));
router.post('/', authenticate, authorizeAdmin, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.create(req.body)));
router.put('/:id', authenticate, authorizeAdmin, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.update(req.params.id, req.body)));
router.delete('/:id', authenticate, authorizeAdmin, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.delete(req.params.id)));
router.patch('/:id/status', authenticate, authorizeAdmin, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.updateStatus(req.params.id, req.body)));

export default router;
