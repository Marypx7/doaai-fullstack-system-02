import express from 'express';
import EngagementController from '../controllers/engagement.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorizeAdmin } from '../middlewares/authorizeAdmin.js';
import { sensitiveWriteRateLimiter } from '../middlewares/rateLimits.js';

const router = express.Router();
const controller = new EngagementController();
const send = (res, result) => res.status(result.statusCode).send(result);

router.get('/favorites', authenticate, async (req, res) =>
  send(res, await controller.listFavorites(req.user.id)));
router.post('/favorites/:productId', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.addFavorite(req.user.id, req.params.productId)));
router.delete('/favorites/:productId', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.removeFavorite(req.user.id, req.params.productId)));
router.get('/favoritos', authenticate, async (req, res) =>
  send(res, await controller.listFavorites(req.user.id)));
router.post('/favoritos', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.addFavorite(req.user.id, req.body?.produtoId ?? req.body?.productId)));
router.delete('/favoritos/:produtoId', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.removeFavorite(req.user.id, req.params.produtoId)));
router.get('/reports', authenticate, async (req, res) =>
  send(res, await controller.listReports(req.user.id)));
router.post('/reports', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.createReport(req.user.id, req.body)));
router.post('/denuncias', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.createReport(req.user.id, {
    productId: req.body?.produtoId ?? req.body?.productId,
    reason: req.body?.motivo ?? req.body?.reason,
    description: req.body?.descricao ?? req.body?.description
  })));
router.get('/denuncias', authenticate, authorizeAdmin, async (_req, res) =>
  send(res, await controller.listAllReports()));
router.patch('/denuncias/:id', authenticate, authorizeAdmin, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.updateReportStatus(req.params.id, {
    status: req.body?.status ?? req.body?.situacao
  })));

export default router;
