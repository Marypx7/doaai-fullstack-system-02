import rateLimit from 'express-rate-limit';

function createRateLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).send({
      success: false,
      statusCode: 429,
      body: message
    })
  });
}

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
});

export const forgotPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  message: 'Muitas solicitações. Tente novamente em alguns minutos.'
});

export const resetPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Muitas tentativas. Tente novamente em alguns minutos.'
});

export const socialAuthRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: 'Muitas tentativas de autenticação social. Tente novamente mais tarde.'
});

export const socialExchangeRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Muitas tentativas de autenticação. Tente novamente mais tarde.'
});

export const signupRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'Limite de cadastros atingido. Tente novamente mais tarde.'
});

export const sensitiveWriteRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: 'Muitas requisições. Tente novamente em alguns minutos.'
});
