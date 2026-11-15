import crypto from 'node:crypto';
import express from 'express';
import * as oauth from 'oauth4webapi';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { Mongo } from '../database/mongo.js';
import { publicUser } from '../helpers/validation.js';
import { createUserDocument, USERS_COLLECTION } from '../models/User.js';
import { authenticate } from '../middlewares/authenticate.js';
import { createAuthToken } from './tokens.js';
import { sensitiveWriteRateLimiter, socialAuthRateLimiter, socialExchangeRateLimiter } from '../middlewares/rateLimits.js';

const router = express.Router();
const TRANSACTIONS_COLLECTION = 'socialAuthTransactions';
const EXCHANGE_CODES_COLLECTION = 'socialAuthExchangeCodes';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS = new Set(['google', 'facebook', 'microsoft']);
const PROVIDER_ERRORS = new Set([
  'not_configured',
  'cancelled',
  'account_exists',
  'already_linked',
  'provider_linked_elsewhere',
  'invalid_link',
  'failed'
]);
const discoveryCache = new Map();
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stateCookieName(provider) {
  return `doaai_oauth_${provider}`;
}

function stateCookieOptions(provider, maxAge) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `${stateCookieName(provider)}=${maxAge ? 'STATE' : ''}`,
    `Path=/api/auth/${provider}/callback`,
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : [])
  ];
}

function setStateCookie(res, provider, state, maxAge = Math.floor(TRANSACTION_TTL_MS / 1000)) {
  const cookie = stateCookieOptions(provider, maxAge);
  cookie[0] = `${stateCookieName(provider)}=${encodeURIComponent(state)}`;
  res.append('Set-Cookie', cookie.join('; '));
}

function clearStateCookie(res, provider) {
  res.append('Set-Cookie', stateCookieOptions(provider, 0).join('; '));
}

function readCookie(req, name) {
  const cookies = req.headers.cookie?.split(';') || [];
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return '';
  }
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function getFrontendBaseUrl() {
  const configured = process.env.FRONTEND_URL;
  if (!configured) throw new Error('FRONTEND_URL is not configured.');
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FRONTEND_URL is invalid.');
  }
  return url;
}

function getBackendBaseUrl() {
  const configured = process.env.BACKEND_URL;
  if (!configured) throw new Error('BACKEND_URL is not configured.');
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BACKEND_URL is invalid.');
  }
  return url;
}

function getCallbackUrl(provider) {
  const providerName = provider.toUpperCase();
  const configured = process.env[`${providerName}_CALLBACK_URL`];
  const callback = configured
    ? new URL(configured)
    : new URL(`/api/auth/${provider}/callback`, getBackendBaseUrl());
  if (!['http:', 'https:'].includes(callback.protocol) ||
      (process.env.NODE_ENV === 'production' && callback.protocol !== 'https:') ||
      callback.username || callback.password ||
      callback.pathname !== `/api/auth/${provider}/callback` ||
      callback.search || callback.hash) {
    throw new Error('OAuth callback URL is invalid.');
  }
  return callback.toString();
}

function getProviderCredentials(provider) {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }
  if (provider === 'facebook') {
    const clientId = process.env.FACEBOOK_APP_ID;
    const clientSecret = process.env.FACEBOOK_APP_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const tenant = process.env.MICROSOFT_TENANT || 'common';
  if (!/^(common|organizations|consumers|[a-f\d-]{36}|[a-z\d.-]+)$/i.test(tenant)) {
    throw new Error('MICROSOFT_TENANT is invalid.');
  }
  return { clientId, clientSecret, tenant };
}

function getFacebookGraphVersion() {
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('FACEBOOK_GRAPH_VERSION is invalid.');
  return version;
}

function createFacebookMetadata() {
  const version = getFacebookGraphVersion();
  return {
    issuer: 'https://www.facebook.com',
    authorization_endpoint: `https://www.facebook.com/${version}/dialog/oauth`,
    token_endpoint: `https://graph.facebook.com/${version}/oauth/access_token`
  };
}

async function getAuthorizationServer(provider, credentials) {
  if (provider === 'facebook') return createFacebookMetadata();
  const issuer = provider === 'google'
    ? new URL('https://accounts.google.com')
    : new URL(`https://login.microsoftonline.com/${credentials.tenant}/v2.0`);
  const cacheKey = `${provider}:${issuer.href}`;
  if (discoveryCache.has(cacheKey)) return discoveryCache.get(cacheKey);

  const metadataPromise = (async () => {
    const response = await oauth.discoveryRequest(issuer, {
      signal: AbortSignal.timeout(10_000)
    });
    if (provider === 'google') {
      return oauth.processDiscoveryResponse(issuer, response);
    }

    if (!response.ok) throw new Error('Microsoft discovery failed.');
    const metadata = await response.json();
    const expectedIssuer = 'https://login.microsoftonline.com/{tenantid}/v2.0';
    const trustedEndpoint = (value) => {
      const endpoint = new URL(value);
      return endpoint.protocol === 'https:' && endpoint.hostname === 'login.microsoftonline.com';
    };
    if (metadata.issuer !== expectedIssuer ||
        !trustedEndpoint(metadata.authorization_endpoint) ||
        !trustedEndpoint(metadata.token_endpoint) ||
        !trustedEndpoint(metadata.jwks_uri) ||
        !metadata.token_endpoint_auth_methods_supported?.includes('client_secret_post')) {
      throw new Error('Microsoft discovery metadata is invalid.');
    }
    return metadata;
  })();

  discoveryCache.set(cacheKey, metadataPromise);
  try {
    return await metadataPromise;
  } catch (error) {
    discoveryCache.delete(cacheKey);
    throw error;
  }
}

function frontendCallbackUrl({ code, error, linked, linkError }) {
  const callback = new URL('/auth/social/callback', getFrontendBaseUrl());
  if (code) callback.hash = new URLSearchParams({ code }).toString();
  if (error) callback.searchParams.set('error', PROVIDER_ERRORS.has(error) ? error : 'failed');
  if (linked) callback.searchParams.set('linked', '1');
  if (linkError) callback.searchParams.set('link_error', PROVIDER_ERRORS.has(linkError) ? linkError : 'failed');
  return callback.toString();
}

function redirectFailure(res, error = 'failed', intent = 'login') {
  try {
    return res.redirect(303, intent === 'link' ? frontendCallbackUrl({ linkError: error }) : frontendCallbackUrl({ error }));
  } catch {
    return res.status(503).send({
      success: false,
      statusCode: 503,
      body: 'A autenticação social não está configurada.'
    });
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

function getMicrosoftCallbackIssuer(callbackUrl, fallbackIssuer) {
  const responseIssuer = callbackUrl.searchParams.get('iss');
  if (!responseIssuer) return fallbackIssuer;
  if (!/^https:\/\/login\.microsoftonline\.com\/[a-f\d-]{36}\/v2\.0$/i.test(responseIssuer)) {
    throw new Error('Microsoft authorization response issuer is invalid.');
  }
  return responseIssuer;
}

async function readIdentity(provider, credentials, server, transaction, callbackUrl, code) {
  if (provider === 'facebook') {
    return readFacebookIdentity(credentials, transaction, callbackUrl, code);
  }

  const callbackServer = provider === 'microsoft'
    ? { ...server, issuer: getMicrosoftCallbackIssuer(callbackUrl, server.issuer) }
    : server;
  const client = { client_id: credentials.clientId };
  const parameters = oauth.validateAuthResponse(
    callbackServer,
    client,
    callbackUrl,
    transaction.state
  );
  if (parameters.get('code') !== code) throw new Error('OAuth authorization code is invalid.');

  const response = await oauth.authorizationCodeGrantRequest(
    callbackServer,
    client,
    oauth.ClientSecretPost(credentials.clientSecret),
    parameters,
    transaction.redirectUri,
    transaction.codeVerifier,
    { signal: AbortSignal.timeout(10_000) }
  );

  let tokenIssuer = callbackServer;
  if (provider === 'microsoft') {
    const tokenBody = await response.clone().json();
    if (typeof tokenBody.id_token !== 'string') throw new Error('Microsoft ID token is missing.');
    const unverifiedClaims = decodeJwt(tokenBody.id_token);
    const tenantId = unverifiedClaims.tid;
    const issuer = unverifiedClaims.iss;
    if (typeof tenantId !== 'string' ||
        !/^[a-f\d-]{36}$/i.test(tenantId) ||
        issuer !== `https://login.microsoftonline.com/${tenantId}/v2.0`) {
      throw new Error('Microsoft ID token issuer is invalid.');
    }
    if (callbackUrl.searchParams.has('iss') && callbackUrl.searchParams.get('iss') !== issuer) {
      throw new Error('Microsoft issuer does not match the authorization response.');
    }
    tokenIssuer = { ...server, issuer };
  }

  const tokenSet = await oauth.processAuthorizationCodeResponse(
    tokenIssuer,
    client,
    response,
    { expectedNonce: transaction.nonce, requireIdToken: true }
  );
  const idToken = tokenSet.id_token;
  const claims = oauth.getValidatedIdTokenClaims(tokenSet);
  if (!claims || typeof idToken !== 'string' || typeof claims.sub !== 'string' || !claims.sub) {
    throw new Error('Provider identity claims are invalid.');
  }

  const jwks = provider === 'google'
    ? googleKeys
    : createRemoteJWKSet(new URL(server.jwks_uri));
  const expectedIssuer = provider === 'google'
    ? ['https://accounts.google.com', 'accounts.google.com']
    : tokenIssuer.issuer;
  const verified = await jwtVerify(idToken, jwks, {
    issuer: expectedIssuer,
    audience: credentials.clientId,
    algorithms: ['RS256']
  });
  const verifiedClaims = verified.payload;
  if (verifiedClaims.nonce !== transaction.nonce ||
      verifiedClaims.sub !== claims.sub ||
      (provider === 'google' && verifiedClaims.email_verified !== true)) {
    throw new Error('Provider identity validation failed.');
  }

  const email = verifiedClaims.email ||
    (provider === 'microsoft' ? verifiedClaims.preferred_username : undefined);
  if (!isValidEmail(email)) throw new Error('Provider did not return a usable email address.');

  return {
    subject: `${verifiedClaims.iss}|${verifiedClaims.sub}`,
    email: email.trim().toLowerCase(),
    name: typeof verifiedClaims.name === 'string' ? verifiedClaims.name.slice(0, 100) : ''
  };
}

async function parseJsonResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 16_384) throw new Error('Provider response is too large.');
  const body = await response.text();
  if (body.length > 16_384) throw new Error('Provider response is too large.');
  return JSON.parse(body);
}

async function readFacebookIdentity(credentials, transaction, callbackUrl, code) {
  const metadata = createFacebookMetadata();
  const client = { client_id: credentials.clientId };
  const parameters = oauth.validateAuthResponse(metadata, client, callbackUrl, transaction.state);
  if (parameters.get('code') !== code) throw new Error('OAuth authorization code is invalid.');

  const tokenUrl = new URL(metadata.token_endpoint);
  tokenUrl.searchParams.set('client_id', credentials.clientId);
  tokenUrl.searchParams.set('client_secret', credentials.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', transaction.redirectUri);
  tokenUrl.searchParams.set('code', code);
  const tokenResponse = await fetch(tokenUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' }
  });
  const tokenBody = await parseJsonResponse(tokenResponse);
  if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string' ||
      typeof tokenBody.token_type !== 'string' || tokenBody.token_type.toLowerCase() !== 'bearer' ||
      !Number.isFinite(tokenBody.expires_in) || tokenBody.expires_in <= 0) {
    throw new Error('Facebook token response is invalid.');
  }

  const version = getFacebookGraphVersion();
  const appToken = `${credentials.clientId}|${credentials.clientSecret}`;
  const debugUrl = new URL(`https://graph.facebook.com/${version}/debug_token`);
  debugUrl.searchParams.set('input_token', tokenBody.access_token);
  debugUrl.searchParams.set('access_token', appToken);
  const debugResponse = await fetch(debugUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' }
  });
  const debugBody = await parseJsonResponse(debugResponse);
  const tokenInfo = debugBody?.data;
  if (!debugResponse.ok || tokenInfo?.is_valid !== true ||
      tokenInfo.app_id !== credentials.clientId ||
      typeof tokenInfo.user_id !== 'string' ||
      (Number.isFinite(tokenInfo.expires_at) && tokenInfo.expires_at > 0 &&
        tokenInfo.expires_at * 1000 <= Date.now()) ||
      (Array.isArray(tokenInfo.scopes) &&
        !['email', 'public_profile'].every((scope) => tokenInfo.scopes.includes(scope)))) {
    throw new Error('Facebook access token validation failed.');
  }

  const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
  profileUrl.searchParams.set('fields', 'id,name,email');
  const profileResponse = await fetch(profileUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tokenBody.access_token}`
    }
  });
  const profile = await parseJsonResponse(profileResponse);
  if (!profileResponse.ok || profile.id !== tokenInfo.user_id ||
      !isValidEmail(profile.email)) {
    throw new Error('Facebook profile response is invalid.');
  }

  return {
    subject: profile.id,
    email: profile.email.trim().toLowerCase(),
    name: typeof profile.name === 'string' ? profile.name.slice(0, 100) : ''
  };
}

async function createSocialIdentity(provider, identity) {
  const collection = Mongo.db.collection(USERS_COLLECTION);
  const existing = await collection.findOne({ [`socialAccounts.${provider}`]: identity.subject });
  if (existing) return existing;

  const existingEmail = await collection.findOne({
    email: new RegExp(`^${identity.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  });
  if (existingEmail) {
    const error = new Error('A local account already uses this email.');
    error.code = 'SOCIAL_ACCOUNT_EXISTS';
    throw error;
  }

  const document = createUserDocument({
    name: identity.name || identity.email.split('@')[0],
    email: identity.email,
    neighborhood: '',
    socialAccounts: { [provider]: identity.subject }
  });
  const result = await collection.insertOne(document);
  return { ...document, _id: result.insertedId };
}

async function linkSocialIdentity(userId, provider, identity) {
  const collection = Mongo.db.collection(USERS_COLLECTION);
  const field = `socialAccounts.${provider}`;
  const linkedUser = await collection.findOne({ [field]: identity.subject });
  if (linkedUser) {
    const error = new Error(linkedUser._id.toString() === userId ? 'already linked' : 'linked elsewhere');
    error.code = linkedUser._id.toString() === userId
      ? 'SOCIAL_ALREADY_LINKED'
      : 'SOCIAL_LINKED_ELSEWHERE';
    throw error;
  }

  const user = await collection.findOneAndUpdate(
    { _id: new ObjectId(userId), [field]: { $exists: false } },
    {
      $set: {
        [field]: identity.subject,
        updatedAt: new Date()
      }
    },
    { returnDocument: 'after' }
  );
  if (!user) {
    const error = new Error('The social provider is already linked to this account.');
    error.code = 'SOCIAL_ALREADY_LINKED';
    throw error;
  }
  return user;
}

function createAuthorizationUrl(provider, credentials, server, callbackUrl, state, nonce, verifier) {
  const authorizationUrl = new URL(server.authorization_endpoint);
  authorizationUrl.searchParams.set('client_id', credentials.clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('state', state);
  if (provider === 'facebook') {
    authorizationUrl.searchParams.set('scope', 'email,public_profile');
  } else {
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', verifier.challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  }
  return authorizationUrl;
}

async function startAuthentication(req, res, provider, intent, userId) {
  if (!PROVIDERS.has(provider)) return res.status(404).send({
    success: false,
    statusCode: 404,
    body: 'Provedor de autenticação inválido.'
  });

  try {
    const credentials = getProviderCredentials(provider);
    if (!credentials) {
      if (intent === 'link') {
        return res.status(503).send({
          success: false,
          statusCode: 503,
          body: 'Este provedor ainda não está configurado.'
        });
      }
      return redirectFailure(res, 'not_configured');
    }

    const callbackUrl = getCallbackUrl(provider);
    const server = await getAuthorizationServer(provider, credentials);
    const state = oauth.generateRandomState();
    const nonce = provider === 'facebook' ? null : oauth.generateRandomNonce();
    let verifier = null;
    let pkce = null;
    if (provider !== 'facebook') {
      verifier = oauth.generateRandomCodeVerifier();
      pkce = { challenge: await oauth.calculatePKCECodeChallenge(verifier) };
    }

    await Mongo.db.collection(TRANSACTIONS_COLLECTION).insertOne({
      stateHash: hash(state),
      provider,
      intent,
      ...(userId ? { userId } : {}),
      nonce,
      codeVerifier: verifier,
      redirectUri: callbackUrl,
      expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS),
      createdAt: new Date()
    });

    const authorizationUrl = createAuthorizationUrl(
      provider,
      credentials,
      server,
      callbackUrl,
      state,
      nonce,
      pkce || {}
    );
    setStateCookie(res, provider, state);
    if (intent === 'link') {
      return res.status(200).send({
        success: true,
        statusCode: 200,
        body: { authorizationUrl: authorizationUrl.toString() }
      });
    }
    return res.redirect(302, authorizationUrl.toString());
  } catch {
    console.error('Não foi possível iniciar autenticação social.', { provider });
    if (intent === 'link') {
      return res.status(503).send({
        success: false,
        statusCode: 503,
        body: 'Não foi possível iniciar a vinculação deste provedor.'
      });
    }
    return redirectFailure(res);
  }
}

router.get('/:provider', socialAuthRateLimiter, (req, res) =>
  startAuthentication(req, res, req.params.provider, 'login'));

router.post('/:provider/link', authenticate, sensitiveWriteRateLimiter, (req, res) =>
  startAuthentication(req, res, req.params.provider, 'link', req.user.id));

router.get('/:provider/callback', socialAuthRateLimiter, async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.has(provider)) return res.status(404).send({
    success: false,
    statusCode: 404,
    body: 'Provedor de autenticação inválido.'
  });

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const browserState = readCookie(req, stateCookieName(provider));
  clearStateCookie(res, provider);
  if (!state || state.length > 256 || !constantTimeEqual(state, browserState)) {
    return redirectFailure(res);
  }

  let transaction;
  try {
    transaction = await Mongo.db.collection(TRANSACTIONS_COLLECTION).findOneAndDelete({
      stateHash: hash(state),
      provider,
      expiresAt: { $gt: new Date() }
    });
    if (!transaction) return redirectFailure(res);

    if (typeof req.query.error === 'string') {
      return redirectFailure(
        res,
        req.query.error === 'access_denied' ? 'cancelled' : 'failed',
        transaction.intent
      );
    }
    if (typeof req.query.code !== 'string' || req.query.code.length > 4096) {
      return redirectFailure(res, 'failed', transaction.intent);
    }

    const credentials = getProviderCredentials(provider);
    if (!credentials) return redirectFailure(res, 'not_configured', transaction.intent);
    const server = await getAuthorizationServer(provider, credentials);
    const callbackUrl = new URL(getCallbackUrl(provider));
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
    }
    const identity = await readIdentity(
      provider,
      credentials,
      server,
      { ...transaction, state },
      callbackUrl,
      req.query.code
    );

    if (transaction.intent === 'link') {
      try {
        await linkSocialIdentity(transaction.userId, provider, identity);
        return res.redirect(303, frontendCallbackUrl({ linked: true }));
      } catch (error) {
        if (error.code === 'SOCIAL_ALREADY_LINKED') return redirectFailure(res, 'already_linked', 'link');
        if (error.code === 'SOCIAL_LINKED_ELSEWHERE') {
          return redirectFailure(res, 'provider_linked_elsewhere', 'link');
        }
        throw error;
      }
    }

    let user;
    try {
      user = await createSocialIdentity(provider, identity);
    } catch (error) {
      if (error.code === 'SOCIAL_ACCOUNT_EXISTS' || error.code === 11000) {
        return redirectFailure(res, 'account_exists');
      }
      throw error;
    }

    const code = crypto.randomBytes(32).toString('base64url');
    await Mongo.db.collection(EXCHANGE_CODES_COLLECTION).insertOne({
      codeHash: hash(code),
      userId: user._id.toString(),
      expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
      createdAt: new Date()
    });
    return res.redirect(303, frontendCallbackUrl({ code }));
  } catch (error) {
    if (error.code === 'SOCIAL_ACCOUNT_EXISTS') return redirectFailure(res, 'account_exists', transaction?.intent);
    console.error('Falha ao concluir autenticação social.', {
      provider,
      error: typeof error?.name === 'string' ? error.name : 'Error'
    });
    return redirectFailure(res, 'failed', transaction?.intent);
  }
});

router.post('/social/exchange', socialExchangeRateLimiter, async (req, res) => {
  const code = req.body?.code;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 || typeof code !== 'string' ||
      !/^[A-Za-z0-9_-]{40,64}$/.test(code)) {
    return res.status(400).send({
      success: false,
      statusCode: 400,
      body: 'Código de autenticação inválido ou expirado.'
    });
  }

  try {
    const exchange = await Mongo.db.collection(EXCHANGE_CODES_COLLECTION).findOneAndDelete({
      codeHash: hash(code),
      expiresAt: { $gt: new Date() }
    });
    if (!exchange || !ObjectId.isValid(exchange.userId)) {
      return res.status(401).send({
        success: false,
        statusCode: 401,
        body: 'Código de autenticação inválido ou expirado.'
      });
    }
    const user = await Mongo.db.collection(USERS_COLLECTION).findOne({
      _id: new ObjectId(exchange.userId)
    });
    if (!user) {
      return res.status(401).send({
        success: false,
        statusCode: 401,
        body: 'Código de autenticação inválido ou expirado.'
      });
    }

    const id = user._id.toString();
    const token = createAuthToken({
      id,
      email: user.email,
      authVersion: Number.isSafeInteger(user.authVersion) ? user.authVersion : 0
    });
    return res.status(200).send({
      success: true,
      statusCode: 200,
      body: {
        token,
        user: { ...publicUser({ ...user, id }), logged: true },
        logged: true
      }
    });
  } catch (error) {
    console.error('Não foi possível concluir a sessão social.', {
      error: typeof error?.name === 'string' ? error.name : 'Error'
    });
    return res.status(500).send({
      success: false,
      statusCode: 500,
      body: 'Não foi possível concluir a autenticação.'
    });
  }
});

export { router as socialAuthRouter };
