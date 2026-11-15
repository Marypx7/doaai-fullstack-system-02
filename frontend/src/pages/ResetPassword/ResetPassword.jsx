import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, Input } from '../../components/index.js';
import './ResetPassword.css';

const EMPTY_VALUES = { password: '', confirmation: '' };

function getInitialToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
}

export default function ResetPassword() {
  const { openLogin, signOut } = useAuth();
  const [token, setToken] = useState(getInitialToken);
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const requestInFlight = useRef(false);

  useLayoutEffect(() => {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname
    );
  }, []);

  function updateField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    setRequestError('');
  }

  function validate() {
    const nextErrors = {};
    if (!token) nextErrors.token = 'O link está incompleto. Solicite uma nova redefinição.';
    if (values.password.length < 8) nextErrors.password = 'A senha deve ter pelo menos 8 caracteres.';
    else if (values.password.length > 1024) nextErrors.password = 'A senha é muito longa.';
    if (values.confirmation !== values.password) {
      nextErrors.confirmation = 'As senhas não coincidem.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit(event) {
    event.preventDefault();
    if (requestInFlight.current || !validate()) return;

    requestInFlight.current = true;
    setLoading(true);
    setRequestError('');
    setSuccess('');
    try {
      await api.post('auth/reset-password', {
        token,
        password: values.password,
        passwordConfirmation: values.confirmation
      });
      signOut();
      setToken('');
      setValues(EMPTY_VALUES);
      setSuccess('Senha redefinida com sucesso. Entre com sua nova senha.');
    } catch (error) {
      setRequestError(error instanceof ApiError
        ? error.message
        : 'Não foi possível redefinir a senha. Verifique sua conexão e tente novamente.');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="reset-password-page">
      <Header />
      <main className="reset-password">
        <header className="reset-password__intro">
          <span className="reset-password__eyebrow">Acesso à sua conta</span>
          <h1>Redefinir senha</h1>
          <p>Escolha uma nova senha para voltar a acessar sua conta DoaAí.</p>
        </header>

        <section className="reset-password__panel" aria-labelledby="reset-password-title">
          {success ? (
            <div className="reset-password__result" role="status" aria-live="polite">
              <h2 id="reset-password-title">Senha atualizada</h2>
              <p>{success}</p>
              <Button onClick={openLogin}>Voltar para entrar</Button>
            </div>
          ) : !token ? (
            <div className="reset-password__result" role="alert">
              <h2 id="reset-password-title">Link indisponível</h2>
              <p>{errors.token || 'Este link é inválido ou já foi utilizado. Solicite uma nova redefinição.'}</p>
              <Button onClick={openLogin}>Voltar para entrar</Button>
            </div>
          ) : (
            <form className="reset-password__form" onSubmit={submit} noValidate>
              <h2 id="reset-password-title">Crie uma nova senha</h2>
              <Input
                label="Nova senha"
                name="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={1024}
                value={values.password}
                onChange={(event) => updateField('password', event.target.value)}
                hint="Use pelo menos 8 caracteres."
                error={errors.password}
                required
                disabled={loading}
              />
              <Input
                label="Confirmar nova senha"
                name="new-password-confirmation"
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={values.confirmation}
                onChange={(event) => updateField('confirmation', event.target.value)}
                error={errors.confirmation}
                required
                disabled={loading}
              />
              {requestError && <p className="reset-password__error" role="alert">{requestError}</p>}
              <Button type="submit" loading={loading}>Salvar nova senha</Button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
