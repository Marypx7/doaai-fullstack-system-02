import express from 'express';
import ProductController from '../controllers/produtoController.js';
import { authenticate } from '../middlewares/authenticate.js';
import { upload, validateUploadedImages } from '../middlewares/upload.js';
import { sensitiveWriteRateLimiter } from '../middlewares/rateLimits.js';

const produtoRouter = express.Router();
const controller = new ProductController();
const send = (res, result) => res.status(result.statusCode).send(result);

produtoRouter.get('/', async (req, res) => send(res, await controller.list(req.query)));
produtoRouter.get('/mine', authenticate, async (req, res) =>
  send(res, await controller.listMine(req.user.id, req.query)));
produtoRouter.get('/:id', async (req, res) => send(res, await controller.get(req.params.id)));
produtoRouter.post('/', authenticate, sensitiveWriteRateLimiter, upload.array('photos', 5), validateUploadedImages, async (req, res) =>
  send(res, await controller.create(req.user.id, req.body, req.files || [])));
produtoRouter.put('/:id', authenticate, sensitiveWriteRateLimiter, upload.array('photos', 5), validateUploadedImages, async (req, res) =>
  send(res, await controller.update(req.params.id, req.user.id, req.body, req.files || [])));
produtoRouter.patch('/:id/status', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.updateStatus(req.params.id, req.user.id, req.body?.status)));
produtoRouter.delete('/:id', authenticate, sensitiveWriteRateLimiter, async (req, res) =>
  send(res, await controller.delete(req.params.id, req.user.id)));

export default produtoRouter;