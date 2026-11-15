import express from 'express';
import cors from 'cors';
import passport from 'passport';
import { Mongo } from './database/mongo.js';
import { authRouter } from './auth/auth.js';
import usersRouter from './routes/users.js';
import productsRouter from './routes/produtoRouters.js';
import categoriesRouter from './routes/categories.js';
import engagementRouter from './routes/engagement.js';

function requireMongo(_req, res, next) {
  if (!Mongo.db) {
    return res.status(503).send({
      success: false,
      statusCode: 503,
      body: 'Banco de dados indisponível. Tente novamente mais tarde.'
    });
  }
  return next();
}

function getAllowedOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS;
  const origins = configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [
        'http://localhost:3000',
        'http://localhost:4173',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:4173',
        'http://127.0.0.1:5173'
      ];
  return new Set(origins);
}

export function createApp() {
  const app = express();

  const allowedOrigins = getAllowedOrigins();
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    }
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(passport.initialize());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ success: true, message: 'API DoaAí funcionando' });
  });

  app.get('/', (_req, res) => {
    res.send({
      success: true,
      statusCode: 200,
      body: 'Bem-vindo ao servidor do projeto de extensão da ADS-FACULDADE'
    });
  });

  app.use([
    '/api/auth',
    '/api/users',
    '/api/usuarios',
    '/api/products',
    '/api/produtos',
    '/api/categories',
    '/api/categorias',
    '/api/favorites',
    '/api/favoritos',
    '/api/reports',
    '/api/denuncias',
    '/auth',
    '/users',
    '/products',
    '/produtos',
    '/categories',
    '/favorites',
    '/reports'
  ], requireMongo);

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/usuarios', usersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/produtos', productsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/categorias', categoriesRouter);
  app.use('/api', engagementRouter);

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/products', productsRouter);
  app.use('/produtos', productsRouter);
  app.use('/categories', categoriesRouter);
  app.use('/', engagementRouter);

  app.use((error, _req, res, _next) => {
    console.error(error);
    const invalidUpload = error.name === 'MulterError' || error.message?.includes('Formato de imagem');
    const clientStatus = Number(error.statusCode || error.status);
    const statusCode = invalidUpload ? 400 : clientStatus >= 400 && clientStatus < 500 ? clientStatus : 500;
    const body = error.name === 'MulterError'
      ? 'Falha ao receber imagens. Verifique o limite de quantidade e tamanho.'
      : error.message?.includes('Formato de imagem')
        ? error.message
        : statusCode === 400
          ? 'Requisição inválida. Verifique o JSON e os campos enviados.'
          : 'Erro interno do servidor.';
    return res.status(statusCode).send({ success: false, statusCode, body });
  });

  return app;
}
