import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../middlewares/authenticate.js';

export function createAuthToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    authVersion: Number.isSafeInteger(user.authVersion) ? user.authVersion : 0
  }, getJwtSecret(), { expiresIn: '7d' });
}
