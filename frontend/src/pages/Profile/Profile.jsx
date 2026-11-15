import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, Input } from '../../components/index.js';
import SocialProviderIcon from '../../components/SocialProviderIcon.jsx';
import './Profile.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY_PROFILE = { name: '', email: '', neighborhood: '' };
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google', hostname: 'accounts.google.com' },
  { id: 'facebook', label: 'Facebook', hostname: 'www.facebook.com' },
  { id: 'microsoft', label: 'Microsoft', hostname: 'login.microsoftonline.com' }
];
const SOCIAL_LINK_ERRORS = {
  not_configured: 'Este provedor ainda não está configurado.',
  cancelled: 'A vinculação foi cancelada.',
  already_linked: 'Esta conta já está conectada a este provedor.',
  provider_linked_elsewhere: 'Este provedor já está conectado a outra conta DoaAí.',
  failed: 'Não foi possível vincular o provedor. Tente novamente.'
};

function readProfile(response) {
  const profile = response?.body;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('A API retornou os dados do perfil em formato inesperado.');
  }
  return {
    name: typeof profile.name === 'string' ? profile.name : '',
    email: typeof profile.email === 'string' ? profile.email : '',
    neighborhood: typeof profile.neighborhood === 'string' ? profile.neighborhood : '',
    connectedProviders: Array.isArray(profile.connectedProviders)
      ? profile.connectedProviders.filter((provider) =>
          ['google', 'facebook', 'microsoft'].includes(provider))
      : []
  };
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Profile() {
  const { token, signOut, openLogin, updateUserProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [values, setValues] = useState(EMPTY_PROFILE);
  const [initialValues, setInitialValues] = useState(EMPTY_PROFILE);
  const [connectedProviders, setConnectedProviders] = useState([]);
  const [loadState, setLoadState] = useState({ loading: true, error: '' });
  const [saveState, setSaveState] = useState({ loading: false, error: '', success: '' });
  const [linkState, setLinkState] = useState({ provider: '', error: '', success: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const saveInProgress = useRef(false);

  useEffect(() => {
    const socialError = searchParams.get('socialError');
    if (socialError) {
      setLinkState({
        provider: '',
        error: SOCIAL_LINK_ERRORS[socialError] || SOCIAL_LINK_ERRORS.failed,
        success: ''
      });
      setSearchParams({}, { replace: true });
      return;
    }
    if (searchParams.get('social') === 'linked') {
      setLinkState({ provider: '', error: '', success: 'Conta social vinculada com sucesso.' });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let active = true;
    if (!token) {
      setValues(EMPTY_PROFILE);
      setInitialValues(EMPTY_PROFILE);
      setConnectedProviders([]);
      setLoadState({ loading: false, error: '' });
      return undefined;
    }

    setLoadState({ loading: true, error: '' });
    api.get('usuarios/me', { token })
      .then((response) => {
        const profile = readProfile(response);
        if (!active) return;
        setConnectedProviders(profile.connectedProviders);
        setValues(profile);
        setInitialValues(profile);
        updateUserProfile(profile);
        setLoadState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          signOut();
          openLogin();
          setLoadState({
            loading: false,
            error: 'Sua sessão expirou. Entre novamente para acessar seu perfil.'
          });
          return;
        }
        setLoadState({
          loading: false,
          error: error instanceof ApiError && error.status === 403
            ? 'Você não tem permissão para acessar este perfil.'
            : getErrorMessage(error, 'Não foi possível carregar seu perfil.')
        });
      });

    return () => {
      active = false;
    };
  }, [openLogin, reloadKey, signOut, token, updateUserProfile]);

  function updateField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
    setSaveState({ loading: false, error: '', success: '' });
  }

  function validate() {
    const errors = {};
    if (!values.name.trim()) errors.name = 'Informe seu nome.';
    else if (values.name.trim().length > 100) errors.name = 'Use até 100 caracteres.';
    if (!values.email.trim()) errors.email = 'Informe seu e-mail.';
    else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Informe um e-mail válido.';
    if (values.neighborhood.length > 120) errors.neighborhood = 'Use até 120 caracteres.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function connectProvider(provider) {
    if (linkState.provider) return;
    const config = SOCIAL_PROVIDERS.find((item) => item.id === provider);
    if (!config || connectedProviders.includes(provider)) return;
    const confirmed = window.confirm(
      `Confirma a autenticação com ${config.label} e a vinculação à sua conta DoaAí?`
    );
    if (!confirmed) return;

    setLinkState({ provider, error: '', success: '' });
    try {
      const response = await api.post(`auth/${provider}/link`, {}, {
        token,
        credentials: 'include'
      });
      const authorizationUrl = response?.body?.authorizationUrl;
      const url = new URL(authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== config.hostname) {
        throw new Error('O provedor retornou um endereço de autenticação inválido.');
      }
      window.location.assign(url.toString());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        openLogin();
      }
      setLinkState({
        provider: '',
        error: getErrorMessage(error, `Não foi possível conectar à conta ${config.label}.`),
        success: ''
      });
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (saveInProgress.current || !validate()) return;

    const normalized = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      neighborhood: values.neighborhood.trim()
    };
    const updates = Object.fromEntries(
      Object.entries(normalized).filter(([field, value]) => value !== initialValues[field])
    );
    if (!Object.keys(updates).length) {
      setSaveState({ loading: false, error: '', success: 'Seus dados já estão atualizados.' });
      return;
    }

    saveInProgress.current = true;
    setSaveState({ loading: true, error: '', success: '' });
    try {
      await api.put('usuarios/me', updates, { token });
      setValues(normalized);
      setInitialValues(normalized);
      updateUserProfile(normalized);
      setSaveState({ loading: false, error: '', success: 'Perfil atualizado com sucesso.' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        openLogin();
        setSaveState({
          loading: false,
          error: 'Sua sessão expirou. Entre novamente para salvar as alterações.',
          success: ''
        });
      } else {
        setSaveState({
          loading: false,
          error: error instanceof ApiError && error.status === 403
            ? 'Você não tem permissão para alterar este perfil.'
            : getErrorMessage(error, 'Não foi possível salvar as alterações.'),
          success: ''
        });
      }
    } finally {
      saveInProgress.current = false;
    }
  }

  return (
    <div className="profile-page">
      <Header />
      <main className="profile">
        <header className="profile__intro">
          <span className="profile__eyebrow">Seus dados pessoais</span>
          <h1>Meu Perfil</h1>
          <p>Consulte e mantenha atualizadas as informações da sua conta.</p>
        </header>

        {!token ? (
          <section className="profile__state">
            <h2>Entre para acessar seu perfil</h2>
            <p>Faça login para visualizar e atualizar suas informações pessoais.</p>
            <Button onClick={openLogin}>Entrar</Button>
          </section>
        ) : loadState.loading ? (
          <section className="profile__state" role="status" aria-live="polite">
            <span className="profile__spinner" aria-hidden="true" />
            <p>Carregando seus dados…</p>
          </section>
        ) : loadState.error ? (
          <section className="profile__state profile__state--error" role="alert">
            <p>{loadState.error}</p>
            {token && (
              <Button variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
                Tentar novamente
              </Button>
            )}
          </section>
        ) : (
          <section className="profile__panel" aria-labelledby="profile-form-title">
            <div className="profile__panel-heading">
              <span className="profile__avatar" aria-hidden="true">
                {values.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'D'}
              </span>
              <div>
                <h2 id="profile-form-title">Informações da conta</h2>
                <p>Edite os dados que deseja manter atualizados.</p>
              </div>
            </div>
            <form className="profile__form" onSubmit={saveProfile} noValidate>
              <Input
                label="Nome"
                name="name"
                autoComplete="name"
                value={values.name}
                onChange={(event) => updateField('name', event.target.value)}
                maxLength={100}
                required
                disabled={saveState.loading}
                error={fieldErrors.name}
              />
              <Input
                label="E-mail"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={(event) => updateField('email', event.target.value)}
                required
                disabled={saveState.loading}
                error={fieldErrors.email}
              />
              <Input
                label="Bairro ou região"
                name="neighborhood"
                autoComplete="address-level3"
                value={values.neighborhood}
                onChange={(event) => updateField('neighborhood', event.target.value)}
                maxLength={120}
                hint="Informação opcional, usada para indicar sua região."
                disabled={saveState.loading}
                error={fieldErrors.neighborhood}
              />

              {saveState.error && <p className="profile__feedback profile__feedback--error" role="alert">{saveState.error}</p>}
              {saveState.success && <p className="profile__feedback profile__feedback--success" role="status">{saveState.success}</p>}
              <div className="profile__actions">
                <Button type="submit" loading={saveState.loading}>Salvar alterações</Button>
              </div>
            </form>

            <section className="profile__connections" aria-labelledby="profile-connections-title">
              <h3 id="profile-connections-title">Contas conectadas</h3>
              <p>Conecte um provedor somente depois de entrar nesta conta DoaAí.</p>
              {linkState.error && (
                <p className="profile__feedback profile__feedback--error" role="alert">{linkState.error}</p>
              )}
              {linkState.success && (
                <p className="profile__feedback profile__feedback--success" role="status">{linkState.success}</p>
              )}
              <div className="profile__connections-list">
                {SOCIAL_PROVIDERS.map(({ id, label }) => {
                  const connected = connectedProviders.includes(id);
                  return (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      disabled={Boolean(linkState.provider) || connected}
                      loading={linkState.provider === id}
                      onClick={() => connectProvider(id)}
                    >
                      <span className="profile__provider-button">
                        <SocialProviderIcon provider={id} />
                        {connected ? `${label} conectado` : `Conectar ${label}`}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </section>
          </section>
        )}
      </main>
    </div>
  );
}
