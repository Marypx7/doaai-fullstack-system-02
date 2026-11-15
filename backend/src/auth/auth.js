import express from 'express';
import crypto from 'node:crypto';
import passport from 'passport';
import LocalStrategy from 'passport-local';
import { Mongo } from '../database/mongo.js';
import { createUserDocument, USERS_COLLECTION } from '../models/User.js';
import { escapeRegex, publicUser, requiredText } from '../helpers/validation.js';
import { hashPassword, verifyPassword } from './password.js';
import { createAuthToken } from './tokens.js';
import { socialAuthRouter } from './socialAuth.js';
import { serverError } from '../helpers/httpResponse.js';
import {
  forgotPasswordRateLimiter,
  loginRateLimiter,
  resetPasswordRateLimiter,
  signupRateLimiter
} from '../middlewares/rateLimits.js';
import { sendPasswordResetEmail } from '../config/email.js';

const authRouter = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const users = () => Mongo.db.collection(USERS_COLLECTION);
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_ACCOUNT_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_RESPONSE = 'Se este e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.';

passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const submittedEmail = email.trim();
      const user = await users().findOne({ email: submittedEmail }) ||
        await users().findOne({ email: new RegExp(`^${escapeRegex(submittedEmail)}$`, 'i') });
      if (!user || !await verifyPassword(password, user.password, user.salt)) {
        return done(null, false, { message: 'E-mail ou senha inválidos.' });
      }
      return done(null, {
        ...publicUser({ ...user, id: user._id.toString() }),
        authVersion: Number.isSafeInteger(user.authVersion) ? user.authVersion : 0
      });
    } catch (error) {
      return done(error);
    }
  }
));

export async function signupHandler(req, res) {
  const { name, email, password, neighborhood = '' } = req.body || {};
  const allowedFields = new Set(['name', 'email', 'password', 'neighborhood']);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((field) => !allowedFields.has(field))) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'O cadastro contém campos não permitidos.'
    });
  }
  if ((name !== undefined && !requiredText(name, 100)) ||
      typeof email !== 'string' || email.length > 254 || !emailPattern.test(email) ||
      typeof password !== 'string' || password.length < 8 || password.length > 1024 ||
      (neighborhood !== '' && !requiredText(neighborhood, 120))) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Informe nome, e-mail válido, senha com pelo menos 8 caracteres e bairro/região válido.'
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await users().findOne({
      email: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i')
    });
    if (existingUser) {
      return res.status(409).send({ success: false, statusCode: 409, body: 'E-mail já cadastrado.' });
    }
    const hashed = await hashPassword(password);
    const document = createUserDocument({
      name: (name || normalizedEmail.split('@')[0]).trim(),
      email: normalizedEmail,
      ...hashed,
      neighborhood: neighborhood.trim()
    });
    const result = await users().insertOne(document);
    const user = { ...document, _id: result.insertedId, id: result.insertedId.toString() };
    const token = createAuthToken(user);
    return res.status(201).send({
      success: true,
      statusCode: 201,
      body: {
        text: 'Usuário cadastrado com sucesso.',
        token,
        user: { ...publicUser(user), logged: true },
        logged: true
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({ success: false, statusCode: 409, body: 'E-mail já cadastrado.' });
    }
    const result = serverError(error);
    return res.status(result.statusCode).send(result);
  }
}

authRouter.post('/signup', signupRateLimiter, signupHandler);

authRouter.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'email') ||
      typeof body.email !== 'string' || body.email.length > 254 ||
      !emailPattern.test(body.email.trim())) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Informe um e-mail válido.'
    });
  }

  const email = body.email.trim().toLowerCase();
  try {
    const user = await users().findOne({
      email: new RegExp(`^${escapeRegex(email)}$`, 'i')
    }, { projection: { _id: 1, email: 1, name: 1 } });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const now = new Date();
      const requestAllowedAfter = new Date(now.getTime() - PASSWORD_RESET_ACCOUNT_COOLDOWN_MS);
      const updatedUser = await users().findOneAndUpdate(
        {
          _id: user._id,
          email: user.email,
          $or: [
            { passwordResetRequestedAt: { $exists: false } },
            { passwordResetRequestedAt: { $lte: requestAllowedAfter } }
          ]
        },
        {
          $set: {
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
            passwordResetRequestedAt: now
          }
        },
        { returnDocument: 'after', projection: { _id: 1 } }
      );

      if (updatedUser) {
        try {
          await sendPasswordResetEmail({ to: user.email, name: user.name, token });
        } catch {
          try {
            await users().updateOne(
              { _id: user._id, passwordResetTokenHash: tokenHash },
              { $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' } }
            );
          } catch {
            console.error('Não foi possível invalidar um token de recuperação não enviado.');
          }
          console.error('Não foi possível enviar o e-mail de recuperação de senha.');
        }
      }
    }

    return res.status(200).send({
      success: true,
      statusCode: 200,
      body: PASSWORD_RESET_RESPONSE
    });
  } catch (error) {
    const result = serverError(error);
    return res.status(result.statusCode).send(result);
  }
});

authRouter.post('/reset-password', resetPasswordRateLimiter, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((field) =>
        !['token', 'password', 'passwordConfirmation'].includes(field)) ||
      typeof body.token !== 'string' || !/^[a-f\d]{64}$/i.test(body.token) ||
      typeof body.password !== 'string' || body.password.length < 8 ||
      body.password.length > 1024 ||
      typeof body.passwordConfirmation !== 'string' ||
      body.passwordConfirmation !== body.password) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Confira o link e informe uma senha válida com confirmação correspondente.'
    });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
    const now = new Date();
    const hashedPassword = await hashPassword(body.password);
    const result = await users().findOneAndUpdate(
      {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: now }
      },
      {
        $set: { ...hashedPassword, updatedAt: now },
        $inc: { authVersion: 1 },
        $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' }
      },
      { returnDocument: 'after', projection: { _id: 1 } }
    );

    if (!result) {
      return res.status(400).send({
        success: false,
        statusCode: 400,
        body: 'O link de redefinição é inválido ou expirou. Solicite um novo link.'
      });
    }

    return res.status(200).send({
      success: true,
      statusCode: 200,
      body: 'Senha redefinida com sucesso. Entre com sua nova senha.'
    });
  } catch (error) {
    const result = serverError(error);
    return res.status(result.statusCode).send(result);
  }
});

authRouter.post('/login', loginRateLimiter, (req, res, next) => {
  const { email, password } = req.body || {};
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((field) => !['email', 'password'].includes(field)) ||
      typeof email !== 'string' || email.length > 254 ||
      typeof password !== 'string' || password.length > 1024) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Informe um e-mail e uma senha válidos.'
    });
  }

  passport.authenticate('local', (error, user) => {
    if (error) {
      const result = serverError(error);
      return res.status(result.statusCode).send(result);
    }
    if (!user) {
      return res.status(401).send({ success: false, statusCode: 401, body: 'E-mail ou senha inválidos.' });
    }

    try {
      const token = createAuthToken(user);
      return res.status(200).send({
        success: true,
        statusCode: 200,
        body: {
          text: 'Login realizado com sucesso.',
          token,
          user: { ...publicUser(user), logged: true },
          logged: true
        }
      });
    } catch (tokenError) {
      const result = serverError(tokenError);
      return res.status(result.statusCode).send(result);
    }
  })(req, res, next);
});

authRouter.use(socialAuthRouter);

export { authRouter };
