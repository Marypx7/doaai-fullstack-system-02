const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api')
  .replace(/\/+$/, '');

export function apiUrlFor(path) {
  return `${API_URL}/${String(path).replace(/^\/+/, '')}`;
}

export class ApiError extends Error {
  constructor(message, { status = 0, body = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, token, headers = {}, credentials } = {}) {
  const requestHeaders = new Headers(headers);
  let requestBody;

  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  if (token) {
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response;
  try {
    response = await fetch(apiUrlFor(path), {
      method,
      headers: requestHeaders,
      body: requestBody,
      ...(credentials ? { credentials } : {})
    });
  } catch (cause) {
    throw new ApiError(
      'Não foi possível conectar à API. Verifique se o backend está em execução.',
      { cause }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  let payload;
  try {
    payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
  } catch (cause) {
    throw new ApiError('A API retornou uma resposta inválida.', {
      status: response.status,
      cause
    });
  }

  const envelope = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? {
        success: payload.success ?? response.ok,
        statusCode: payload.statusCode ?? response.status,
        body: Object.hasOwn(payload, 'body') ? payload.body : payload
      }
    : {
        success: response.ok,
        statusCode: response.status,
        body: payload
      };

  if (!response.ok || !envelope.success) {
    const message = typeof envelope.body === 'string'
      ? envelope.body
      : envelope.body?.message || `A requisição falhou (HTTP ${response.status}).`;
    throw new ApiError(message, {
      status: response.status,
      body: envelope.body
    });
  }

  return envelope;
}

export const api = {
  request,
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' })
};
