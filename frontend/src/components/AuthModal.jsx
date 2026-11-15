import { useEffect, useRef, useState } from 'react';
import { ApiError, api, apiUrlFor } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import Button from './Button.jsx';
import Input from './Input.jsx';
import Modal from './Modal.jsx';
import SocialProviderIcon from './SocialProviderIcon.jsx';
import './AuthModal.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Continuar com Google' },
  { id: 'facebook', label: 'Continuar com Facebook' },
  { id: 'microsoft', label: 'Continuar com Microsoft' }
];

function getAuthenticationData(response) {
  const data = response?.body;
  if (typeof data?.token !== 'string' || !data.token || !data.user || typeof data.user !== 'object') {
    throw new Error('A API retornou uma resposta de autenticação inválida.');
  }
  return { token: data.token, user: data.user };
}

export default function AuthModal() {
  const {
    authModal,
    closeAuthModal,
    openLogin,
    openSignup,
    signIn
  } = useAuth();
  const [values, setValues] = useState({
    name: '',
    email: '',
    neighborhood: '',
    password: '',
    passwordConfirmation: ''
  });
  const [errors, setErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [socialLoading, setSocialLoading] = useState('');
  const [mode, setMode] = useState('login');
  const requestInFlight = useRef(false);
  const isSignup = authModal === 'signup' && mode === 'signup';
  const isRecovery = authModal === 'login' && mode === 'recovery';

  useEffect(() => {
    setMode(authModal === 'signup' ? 'signup' : 'login');
    setRequestError('');
    setRecoveryMessage('');
    setErrors({});
  }, [authModal]);

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    setRequestError('');
    setRecoveryMessage('');
  }

  function validate() {
    const nextErrors = {};
    if (isSignup && values.name.trim().length > 100) nextErrors.name = 'Use até 100 caracteres.';
    if (!values.email.trim()) nextErrors.email = 'Informe seu e-mail.';
    else if (values.email.length > 254 || !EMAIL_PATTERN.test(values.email.trim())) {
      nextErrors.email = 'Informe um e-mail válido.';
    }
    if (isSignup && values.neighborhood.length > 120) {
      nextErrors.neighborhood = 'Use até 120 caracteres.';
    }
    if (!isRecovery) {
      if (!values.password) nextErrors.password = 'Informe sua senha.';
      else if (isSignup && values.password.length < 8) {
        nextErrors.password = 'A senha deve ter pelo menos 8 caracteres.';
      } else if (values.password.length > 1024) {
        nextErrors.password = 'A senha é muito longa.';
      }
      if (isSignup && values.passwordConfirmation !== values.password) {
        nextErrors.passwordConfirmation = 'As senhas não coincidem.';
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (requestInFlight.current || !validate()) return;

    requestInFlight.current = true;
    setLoading(true);
    setRequestError('');
    setRecoveryMessage('');
    try {
      if (isRecovery) {
        await api.post('auth/forgot-password', { email: values.email.trim() });
        setRecoveryMessage('Se este e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.');
        return;
      }
      const path = isSignup ? 'usuarios' : 'auth/login';
      const body = isSignup
        ? {
            ...(values.name.trim() ? { name: values.name.trim() } : {}),
            email: values.email.trim(),
            password: values.password,
            neighborhood: values.neighborhood.trim()
          }
        : { email: values.email.trim(), password: values.password };
      const response = await api.post(path, body);
      signIn(getAuthenticationData(response));
    } catch (error) {
      setRequestError(error instanceof ApiError
        ? error.message
        : error.message || 'Não foi possível concluir a autenticação.');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }

  function startSocialLogin(provider) {
    if (requestInFlight.current || loading) return;
    requestInFlight.current = true;
    setSocialLoading(provider);
    setRequestError('');
    window.location.assign(apiUrlFor(`auth/${provider}`));
  }

  function switchMode(mode) {
    setValues({
      name: '',
      email: values.email,
      neighborhood: '',
      password: '',
      passwordConfirmation: ''
    });
    setErrors({});
    setRequestError('');
    setRecoveryMessage('');
    if (mode === 'signup') {
      setMode('signup');
      openSignup();
    } else {
      setMode('login');
      openLogin();
    }
  }

  function showRecoveryForm() {
    setMode('recovery');
    setErrors({});
    setRequestError('');
    setRecoveryMessage('');
  }

  return (
    <Modal
      open={Boolean(authModal)}
      onClose={closeAuthModal}
      title={isRecovery ? 'Recuperar senha' : isSignup ? 'Crie sua conta' : 'Bem-vindo ao DoaAí'}
      description={isRecovery
        ? 'Informe seu e-mail para receber um link seguro de redefinição.'
        : isSignup
        ? 'Faça parte da comunidade de doação circular.'
        : 'Entre para continuar compartilhando com a comunidade.'}
      className="auth-modal"
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {isSignup && (
          <Input
            label="Nome (opcional)"
            name="name"
            autoComplete="name"
            maxLength={100}
            value={values.name}
            onChange={(event) => setField('name', event.target.value)}
            error={errors.name}
            disabled={loading}
          />
        )}

        <Input
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={values.email}
          onChange={(event) => setField('email', event.target.value)}
          error={errors.email}
          required
          disabled={loading}
        />

        {isSignup && (
          <Input
            label="Bairro ou região (opcional)"
            name="neighborhood"
            autoComplete="address-level3"
            maxLength={120}
            value={values.neighborhood}
            onChange={(event) => setField('neighborhood', event.target.value)}
            error={errors.neighborhood}
            disabled={loading}
          />
        )}

        {!isRecovery && (
          <Input
            label="Senha"
            name="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            maxLength={1024}
            value={values.password}
            onChange={(event) => setField('password', event.target.value)}
            error={errors.password}
            hint={isSignup ? 'Use pelo menos 8 caracteres.' : undefined}
            required
            disabled={loading}
          />
        )}

        {isSignup && (
          <Input
            label="Confirme sua senha"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            value={values.passwordConfirmation}
            onChange={(event) => setField('passwordConfirmation', event.target.value)}
            error={errors.passwordConfirmation}
            required
            disabled={loading}
          />
        )}

        {!isSignup && !isRecovery && (
          <button className="auth-form__text-link auth-form__forgot" type="button" onClick={showRecoveryForm}>
            Esqueceu sua senha?
          </button>
        )}

        {recoveryMessage && <p className="auth-form__notice" role="status">{recoveryMessage}</p>}
        {requestError && <p className="auth-form__error" role="alert">{requestError}</p>}

        <Button type="submit" className="auth-form__submit" loading={loading}>
          {isRecovery ? 'Enviar instruções' : isSignup ? 'Criar conta' : 'Entrar'}
        </Button>

        <p className="auth-form__switch">
          {isRecovery ? 'Lembrou sua senha?' : isSignup ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'}
          {' '}
          <button
            className="auth-form__text-link"
            type="button"
            disabled={loading}
            onClick={() => switchMode(isSignup || isRecovery ? 'login' : 'signup')}
          >
            {isSignup ? 'Entrar' : isRecovery ? 'Voltar para entrar' : 'Criar conta'}
          </button>
        </p>

        {!isRecovery && (
          <div className="auth-social" aria-label="Autenticação social">
            <div className="auth-social__separator"><span>ou continue com</span></div>
            <div className="auth-social__buttons">
              {SOCIAL_PROVIDERS.map(({ id, label }) => (
                <button
                  key={id}
                  className="auth-social__button"
                  type="button"
                  aria-label={label}
                  aria-busy={socialLoading === id}
                  disabled={loading || Boolean(socialLoading)}
                  onClick={() => startSocialLogin(id)}
                >
                  <SocialProviderIcon provider={id} />
                  <span>{socialLoading === id ? 'Conectando…' : label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
