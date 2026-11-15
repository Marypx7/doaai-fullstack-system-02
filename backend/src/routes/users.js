import express from 'express';
import UsersControllers from '../controllers/users.js';
import { authenticate } from '../middlewares/authenticate.js';
import { signupHandler } from '../auth/auth.js';
import ProductController from '../controllers/produtoController.js';
import { sensitiveWriteRateLimiter, signupRateLimiter } from '../middlewares/rateLimits.js';

const usersRouter = express.Router();

const usersControllers = new UsersControllers();
const productsController = new ProductController();

usersRouter.post('/', signupRateLimiter, signupHandler);
usersRouter.get('/', authenticate, async (req, res) => {
    const { success, statusCode, body } = await usersControllers.getUsers();

    return res.status(statusCode).send({ success, statusCode, body });
});

usersRouter.get('/me', authenticate, async (req, res) => {
    const result = await usersControllers.getMe(req.user.id);
    return res.status(result.statusCode).send(result);
});

usersRouter.put('/me', authenticate, sensitiveWriteRateLimiter, async (req, res) => {
    const result = await usersControllers.updateUser(req.user.id, req.body, req.user.id);
    return res.status(result.statusCode).send(result);
});

usersRouter.get('/me/produtos', authenticate, async (req, res) => {
    const result = await productsController.listMine(req.user.id, req.query);
    return res.status(result.statusCode).send(result);
});

//: id é o parametro que vamos passar na url para deletar um usuário
usersRouter.delete('/:id', authenticate, sensitiveWriteRateLimiter, async (req, res) => {
   
   const { success, statusCode, body } = await usersControllers.deleteUser(req.params.id, req.user.id);

   return res.status(statusCode).send({ success, statusCode, body });
})

usersRouter.put('/:id', authenticate, sensitiveWriteRateLimiter, async (req, res) => {
    const { success, statusCode, body } = await usersControllers.updateUser(
        req.params.id,
        req.body,
        req.user.id
    );

    return res.status(statusCode).send({ success, statusCode, body });
});

export default usersRouter;