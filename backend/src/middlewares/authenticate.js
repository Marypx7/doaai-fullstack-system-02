import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { Mongo } from '../database/mongo.js';
import { USERS_COLLECTION } from '../models/User.js';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET deve estar configurado e conter pelo menos 32 caracteres.');
  }
  return secret;
}

export async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return res.status(401).send({ success: false, statusCode: 401, body: 'Token de autenticação obrigatório.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error.message.startsWith('JWT_SECRET')) {
      return res.status(500).send({ success: false, statusCode: 500, body: error.message });
    }
    return res.status(401).send({ success: false, statusCode: 401, body: 'Token inválido ou expirado.' });
  }

  if (typeof payload !== 'object' ||
      typeof payload.id !== 'string' ||
      !/^[a-f\d]{24}$/i.test(payload.id) ||
      !ObjectId.isValid(payload.id) ||
      (payload.authVersion !== undefined &&
        (!Number.isSafeInteger(payload.authVersion) || payload.authVersion < 0))) {
    return res.status(401).send({ success: false, statusCode: 401, body: 'Token inválido.' });
  }

  try {
    const user = await Mongo.db.collection(USERS_COLLECTION).findOne(
      { _id: new ObjectId(payload.id) },
      { projection: { authVersion: 1 } }
    );
    if (!user || (user.authVersion || 0) !== (payload.authVersion || 0)) {
      return res.status(401).send({ success: false, statusCode: 401, body: 'Token inválido ou expirado.' });
    }
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch {
    return res.status(500).send({
      success: false,
      statusCode: 500,
      body: 'Não foi possível validar a sessão.'
    });
  }
}
