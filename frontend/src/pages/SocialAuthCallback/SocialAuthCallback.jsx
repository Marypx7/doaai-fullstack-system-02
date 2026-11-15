import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header } from '../../components/index.js';
import './SocialAuthCallback.css';

const SOCIAL_ERRORS = {
  not_configured: 'Este provedor ainda não está configurado. Tente novamente mais tarde.',
  cancelled: 'A autenticação foi cancelada.',
  account_exists: 'Já existe uma conta DoaAí com este e-mail. Entre nela e conecte o provedor pelo seu perfil para confirmar a vinculação.',
  already_linked: 'Esta conta já está conectada a este provedor.',
  provider_linked_elsewhere: 'Este provedor já está conectado a outra conta DoaAí.',
  invalid_link: 'Não foi possível vincular este provedor à conta atual.',
  failed: 'Não foi possível concluir a autenticação. Tente novamente.'
};

export default function SocialAuthCallback() {
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const { signIn, openLogin } = useAuth();
  const [state, setState] = useState({ loading: true, error: '' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(search);
    if (params.get('linked') === '1') {
      window.history.replaceState(null, '', window.location.pathname);
      navigate('/perfil?social=linked', { replace: true });
      return;
    }

    const linkError = params.get('link_error');
    if (linkError) {
      window.history.replaceState(null, '', window.location.pathname);
      navigate(`/perfil?socialError=${encodeURIComponent(linkError)}`, { replace: true });
      return;
    }

    const error = params.get('error');
    if (error) {
      window.history.replaceState(null, '', window.location.pathname);
      setState({
        loading: false,
        error: SOCIAL_ERRORS[error] || SOCIAL_ERRORS.failed
      });
      return;
    }

    const code = new URLSearchParams(hash.replace(/^#/, '')).get('code');
    window.history.replaceState(null, '', window.location.pathname);
    if (!code) {
      setState({ loading: false, error: SOCIAL_ERRORS.failed });
      return;
    }

    api.post('auth/social/exchange', { code })
      .then((response) => {
        const session = response?.body;
        if (typeof session?.token !== 'string' || !session.token ||
            !session.user || typeof session.user !== 'object') {
          throw new Error('A API retornou uma sessão inválida.');
        }
        signIn({ token: session.token, user: session.user });
        navigate('/', { replace: true });
      })
      .catch((requestError) => {
        setState({
          loading: false,
          error: requestError instanceof ApiError
            ? requestError.message
            : 'Não foi possível concluir a autenticação. Tente novamente.'
        });
      });
  }, [hash, navigate, search, signIn]);

  return (
    <div className="social-callback-page">
      <Header />
      <main className="social-callback">
        <section className="social-callback__panel" aria-live="polite">
          {state.loading ? (
            <>
              <span className="social-callback__spinner" aria-hidden="true" />
              <h1>Concluindo sua autenticação</h1>
              <p>Aguarde enquanto confirmamos sua sessão do DoaAí.</p>
            </>
          ) : (
            <>
              <h1>Não foi possível entrar</h1>
              <p role="alert">{state.error}</p>
              <div className="social-callback__actions">
                <Button
                  onClick={() => {
                    navigate('/', { replace: true });
                    openLogin();
                  }}
                >
                  Voltar ao login
                </Button>
                <Button variant="outline" onClick={() => navigate('/', { replace: true })}>
                  Ir para o início
                </Button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
