import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, afterEach, test } from 'node:test';
import request from 'supertest';

process.env.JWT_SECRET = 'doaai-social-test-secret-with-at-least-thirty-two-characters';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.FRONTEND_URL = 'http://frontend.example.test';
process.env.BACKEND_URL = 'http://backend.example.test';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.FACEBOOK_APP_ID = 'facebook-app-id';
// Test-only mock fixture; never put a real Facebook app secret here.
process.env.FACEBOOK_APP_SECRET = 'facebook-app-secret';
process.env.MICROSOFT_CLIENT_ID = 'microsoft-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-client-secret';
process.env.MICROSOFT_TENANT = 'common';

const { ObjectId } = await import('mongodb');
const jwt = (await import('jsonwebtoken')).default;
const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
const { Mongo } = await import('../src/database/mongo.js');
const { createApp } = await import('../src/app.js');

const providers = {
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    issuer: 'https://accounts.google.com',
    discovery: 'https://accounts.google.com/.well-known/openid-configuration',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    clientId: process.env.GOOGLE_CLIENT_ID
  },
  microsoft: {
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    issuerTemplate: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    issuer: 'https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0',
    discovery: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    clientId: process.env.MICROSOFT_CLIENT_ID,
    tenantId: '11111111-2222-4333-8444-555555555555'
  },
  facebook: {
    authorizationEndpoint: 'https://www.facebook.com/v26.0/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/v26.0/oauth/access_token',
    graph: 'https://graph.facebook.com/v26.0',
    clientId: process.env.FACEBOOK_APP_ID
  }
};

const keyPair = await generateKeyPair('RS256');
const jwk = await exportJWK(keyPair.publicKey);
jwk.kid = 'social-auth-test-key';
jwk.alg = 'RS256';
jwk.use = 'sig';

function readPath(document, path) {
  return path.split('.').reduce((value, part) => value?.[part], document);
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = readPath(document, path);
    if (expected instanceof ObjectId) return actual instanceof ObjectId && actual.equals(expected);
    if (expected instanceof RegExp) return expected.test(actual || '');
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false;
      if ('$gt' in expected && !(actual > expected.$gt)) return false;
      if ('$ne' in expected && actual === expected.$ne) return false;
      return true;
    }
    return actual === expected;
  });
}

function setPath(document, path, value) {
  const parts = path.split('.');
  let current = document;
  for (const part of parts.slice(0, -1)) current = current[part] ||= {};
  current[parts.at(-1)] = value;
}

function createDatabase() {
  const users = [];
  const transactions = [];
  const codes = [];

  function transientCollection(records) {
    return {
      async insertOne(document) {
        records.push({ ...document });
        return { insertedId: new ObjectId() };
      },
      async findOneAndDelete(query) {
        const index = records.findIndex((record) => matches(record, query));
        if (index < 0) return null;
        return records.splice(index, 1)[0];
      },
      async deleteOne(query) {
        const index = records.findIndex((record) => matches(record, query));
        if (index < 0) return { deletedCount: 0 };
        records.splice(index, 1);
        return { deletedCount: 1 };
      }
    };
  }

  return {
    users,
    transactions,
    codes,
    db: {
      collection(name) {
        if (name === 'users') {
          return {
            async findOne(query) {
              return users.find((user) => matches(user, query)) || null;
            },
            async insertOne(document) {
              if (users.some((user) => user.email === document.email)) {
                const error = new Error('duplicate key');
                error.code = 11000;
                throw error;
              }
              for (const provider of ['google', 'facebook', 'microsoft']) {
                if (document.socialAccounts?.[provider] &&
                    users.some((user) => user.socialAccounts?.[provider] === document.socialAccounts[provider])) {
                  const error = new Error('duplicate key');
                  error.code = 11000;
                  throw error;
                }
              }
              const insertedId = new ObjectId();
              users.push({ ...document, _id: insertedId });
              return { insertedId };
            },
            async findOneAndUpdate(query, update) {
              const user = users.find((candidate) => matches(candidate, query));
              if (!user) return null;
              for (const [path, value] of Object.entries(update.$set || {})) setPath(user, path, value);
              return user;
            }
          };
        }
        if (name === 'socialAuthTransactions') return transientCollection(transactions);
        if (name === 'socialAuthExchangeCodes') return transientCollection(codes);
        throw new Error(`Unexpected collection: ${name}`);
      }
    }
  };
}

let state;
let app;
let originalFetch;
let observed;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createMockFetch(provider, {
  email = 'person@example.test',
  sub = 'provider-subject',
  audience,
  nonce
} = {}) {
  const config = providers[provider];
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.href === config.discovery) {
      if (provider === 'google') {
        return jsonResponse({
          issuer: config.issuer,
          authorization_endpoint: config.authorizationEndpoint,
          token_endpoint: config.tokenEndpoint,
          jwks_uri: config.jwks,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          authorization_response_iss_parameter_supported: true,
          code_challenge_methods_supported: ['S256']
        });
      }
      return jsonResponse({
        issuer: config.issuerTemplate,
        authorization_endpoint: config.authorizationEndpoint,
        token_endpoint: config.tokenEndpoint,
        jwks_uri: config.jwks,
        token_endpoint_auth_methods_supported: ['client_secret_post']
      });
    }
    if (url.href === config.jwks) return jsonResponse({ keys: [jwk] });
    if (url.href === config.tokenEndpoint) {
      const requestParams = new URLSearchParams(init.body);
      observed.codeVerifier = requestParams.get('code_verifier');
      observed.tokenExchangeCount += 1;
      const claims = {
        iss: config.issuer,
        aud: audience || config.clientId,
        sub,
        email,
        name: 'Pessoa Social',
        nonce: nonce || observed.nonce,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
        ...(provider === 'google' ? { email_verified: true } : {}),
        ...(provider === 'microsoft' ? {
          iss: config.issuer,
          tid: config.tenantId,
          preferred_username: email
        } : {})
      };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .sign(keyPair.privateKey);
      return jsonResponse({ access_token: 'provider-access-token', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
    }
    if (provider === 'facebook' && url.href.startsWith(`${config.graph}/oauth/access_token?`)) {
      observed.facebookExchange = url;
      return jsonResponse({ access_token: 'facebook-access-token', token_type: 'bearer', expires_in: 3600 });
    }
    if (provider === 'facebook' && url.href.startsWith(`${config.graph}/debug_token?`)) {
      observed.facebookAppToken = url.searchParams.get('access_token');
      return jsonResponse({
        data: {
          app_id: config.clientId,
          user_id: sub,
          is_valid: true,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          scopes: ['email', 'public_profile']
        }
      });
    }
    if (provider === 'facebook' && url.href.startsWith(`${config.graph}/me?`)) {
      observed.facebookProfileAuth = new Headers(init.headers).get('authorization');
      return jsonResponse({ id: sub, name: 'Pessoa Facebook', email });
    }
    throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`);
  };
}

async function beginFlow(provider, fetchMock, path = `/api/auth/${provider}`) {
  globalThis.fetch = fetchMock;
  const response = await request(app).get(path);
  assert.equal(response.status, 302);
  const authorizationUrl = new URL(response.headers.location);
  observed.stateCookie = response.headers['set-cookie']?.[0]?.split(';')[0];
  observed.state = authorizationUrl.searchParams.get('state');
  observed.nonce = authorizationUrl.searchParams.get('nonce');
  return authorizationUrl;
}

async function completeFlow(provider, code = 'provider-code') {
  const config = providers[provider];
  const response = await request(app)
    .get(`/api/auth/${provider}/callback`)
    .set('Cookie', observed.stateCookie)
    .query({
      state: observed.state,
      code,
      ...(provider === 'google' ? { iss: config.issuer } : {})
    });
  return response;
}

beforeEach(() => {
  state = createDatabase();
  Mongo.db = state.db;
  app = createApp();
  originalFetch = globalThis.fetch;
  observed = { tokenExchangeCount: 0 };
});

afterEach(() => {
  Mongo.db = null;
  globalThis.fetch = originalFetch;
});

test('Google OAuth creates a passwordless account and exchanges a one-time application code', async () => {
  const authorizationUrl = await beginFlow('google', createMockFetch('google'));
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(typeof observed.nonce, 'string');

  const callback = await completeFlow('google');
  assert.equal(callback.status, 303);
  assert.match(callback.headers.location, /#code=/);
  const socialCode = new URL(callback.headers.location).hash.slice('#code='.length);
  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].password, undefined);
  assert.equal(state.users[0].salt, undefined);
  assert.equal(state.users[0].socialAccounts.google, 'https://accounts.google.com|provider-subject');
  assert.equal(typeof observed.codeVerifier, 'string');

  const session = await request(app).post('/api/auth/social/exchange').send({ code: socialCode });
  assert.equal(session.status, 200);
  assert.equal(typeof session.body.body.token, 'string');
  assert.equal(session.body.body.user.socialAccounts, undefined);
  const profile = await request(app).get('/api/usuarios/me')
    .set('Authorization', `Bearer ${session.body.body.token}`);
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.body.connectedProviders, ['google']);
  assert.equal(profile.body.body.socialAccounts, undefined);
  const replay = await request(app).post('/api/auth/social/exchange').send({ code: socialCode });
  assert.equal(replay.status, 401);

  await beginFlow('google', createMockFetch('google'));
  const returningLogin = await completeFlow('google');
  const returningCode = new URL(returningLogin.headers.location).hash.slice('#code='.length);
  const returningSession = await request(app)
    .post('/api/auth/social/exchange')
    .send({ code: returningCode });
  assert.equal(returningSession.status, 200);
  assert.equal(returningSession.body.body.user.id, session.body.body.user.id);
  assert.equal(state.users.length, 1);
});

test('Google does not auto-link an existing email account and allows explicit linking after local authentication', async () => {
  const localUser = {
    _id: new ObjectId(),
    email: 'person@example.test',
    name: 'Pessoa local',
    neighborhood: '',
    authVersion: 0,
    password: 'a-local-hash',
    salt: 'a-local-salt'
  };
  state.users.push(localUser);
  const fetchMock = createMockFetch('google');

  await beginFlow('google', fetchMock);
  const conflict = await completeFlow('google');
  assert.equal(new URL(conflict.headers.location).searchParams.get('error'), 'account_exists');
  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].socialAccounts, undefined);

  const localToken = jwt.sign({
    id: localUser._id.toString(),
    authVersion: 0
  }, process.env.JWT_SECRET);
  const linkStart = await request(app)
    .post('/api/auth/google/link')
    .set('Authorization', `Bearer ${localToken}`)
    .send({});
  assert.equal(linkStart.status, 200);
  observed.stateCookie = linkStart.headers['set-cookie']?.[0]?.split(';')[0];
  const authorizationUrl = new URL(linkStart.body.body.authorizationUrl);
  observed.state = authorizationUrl.searchParams.get('state');
  observed.nonce = authorizationUrl.searchParams.get('nonce');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');

  const linked = await completeFlow('google');
  assert.equal(new URL(linked.headers.location).searchParams.get('linked'), '1');
  assert.equal(localUser.socialAccounts.google, 'https://accounts.google.com|provider-subject');
  assert.equal(state.users.length, 1);
});

test('Facebook login validates its app token and uses only email and public-profile permissions', async () => {
  const authorizationUrl = await beginFlow('facebook', createMockFetch('facebook'));
  assert.equal(authorizationUrl.searchParams.get('scope'), 'email,public_profile');
  const callback = await completeFlow('facebook');
  assert.equal(callback.status, 303);
  assert.match(callback.headers.location, /#code=/);
  assert.equal(observed.facebookExchange.searchParams.get('client_secret'), process.env.FACEBOOK_APP_SECRET);
  assert.equal(observed.facebookAppToken, `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`);
  assert.equal(observed.facebookProfileAuth, 'Bearer facebook-access-token');
  assert.equal(state.users[0].socialAccounts.facebook, 'provider-subject');
});

test('Microsoft OIDC validates the tenant issuer and accepts the configured common tenant', async () => {
  const authorizationUrl = await beginFlow('microsoft', createMockFetch('microsoft'));
  assert.equal(authorizationUrl.origin, 'https://login.microsoftonline.com');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  const callback = await completeFlow('microsoft');
  assert.equal(callback.status, 303);
  assert.equal(state.users[0].socialAccounts.microsoft,
    `${providers.microsoft.issuer}|provider-subject`);
  assert.equal(state.users[0].email, 'person@example.test');
});

test('OAuth invalid state fails before exchanging provider tokens', async () => {
  await beginFlow('google', createMockFetch('google'));
  const response = await request(app)
    .get('/api/auth/google/callback')
    .set('Cookie', observed.stateCookie)
    .query({ state: crypto.randomBytes(32).toString('hex'), code: 'provider-code', iss: providers.google.issuer });
  assert.equal(response.status, 303);
  assert.equal(observed.tokenExchangeCount, 0);
  assert.equal(state.users.length, 0);
});

test('OAuth state must match the initiating browser cookie', async () => {
  await beginFlow('google', createMockFetch('google'));
  const mismatchedBrowser = await request(app)
    .get('/api/auth/google/callback')
    .query({ state: observed.state, code: 'provider-code', iss: providers.google.issuer });
  assert.equal(mismatchedBrowser.status, 303);
  assert.equal(new URL(mismatchedBrowser.headers.location).searchParams.get('error'), 'failed');
  assert.equal(observed.tokenExchangeCount, 0);
  assert.equal(state.users.length, 0);
});

test('OIDC rejects an ID token issued for another audience', async () => {
  await beginFlow('google', createMockFetch('google', { audience: 'another-client-id' }));
  const callback = await completeFlow('google');
  assert.equal(callback.status, 303);
  assert.equal(new URL(callback.headers.location).searchParams.get('error'), 'failed');
  assert.equal(state.users.length, 0);
});

test('unconfigured providers do not create or simulate an account', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  try {
    const response = await request(app).get('/api/auth/google');
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.location).searchParams.get('error'), 'not_configured');
    assert.equal(state.users.length, 0);
    assert.equal(state.transactions.length, 0);
  } finally {
    process.env.GOOGLE_CLIENT_ID = previousClientId;
    process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
  }
});

test('provider cancellation returns a safe cancellation state without creating an account', async () => {
  await beginFlow('google', createMockFetch('google'));
  const callback = await request(app)
    .get('/api/auth/google/callback')
    .set('Cookie', observed.stateCookie)
    .query({ state: observed.state, error: 'access_denied', iss: providers.google.issuer });
  assert.equal(callback.status, 303);
  assert.equal(new URL(callback.headers.location).searchParams.get('error'), 'cancelled');
  assert.equal(observed.tokenExchangeCount, 0);
  assert.equal(state.users.length, 0);
});
