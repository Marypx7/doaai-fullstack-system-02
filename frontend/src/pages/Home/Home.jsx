import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Header, ProductCard } from '../../components/index.js';
import { api } from '../../services/api.js';
import './Home.css';

const HOW_IT_WORKS = [
  {
    number: '01',
    title: 'Publique um item',
    description: 'Cadastre o que você não usa mais e encontre alguém que precisa.',
    icon: 'publish'
  },
  {
    number: '02',
    title: 'Explore as doações',
    description: 'Descubra itens disponíveis perto de você e escolha o que precisa.',
    icon: 'explore'
  },
  {
    number: '03',
    title: 'Conecte-se com a comunidade',
    description: 'Combine a retirada e faça parte de uma rede de cuidado e reutilização.',
    icon: 'community'
  }
];

function StepIcon({ name }) {
  const paths = {
    publish: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 14v5h14v-5" />
      </>
    ),
    explore: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4 4" />
        <path d="M8 11h5M10.5 8.5v5" />
      </>
    ),
    community: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8" />
      </>
    )
  };

  return (
    <svg
      className="home-step__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function readProductList(response) {
  const body = response?.body;
  if (!body || !Array.isArray(body.items) || !Number.isFinite(body.total)) {
    throw new Error('A API retornou uma lista de produtos em formato inesperado.');
  }
  return body;
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [productsState, setProductsState] = useState({ loading: true, error: '' });
  const [stats, setStats] = useState({
    available: null,
    donated: null,
    community: null,
    loading: true
  });
  const [reloadKey, setReloadKey] = useState(0);
  const requestsRef = useRef(null);

  const loadHomeData = useCallback(async (signal) => {
    setProductsState({ loading: true, error: '' });
    setStats((current) => ({ ...current, loading: true }));

    requestsRef.current ||= Promise.allSettled([
      api.get('produtos?status=disponivel&page=1&limit=3&ordenacao=recentes'),
      api.get('produtos?status=doado&page=1&limit=1&ordenacao=recentes')
    ]);
    const [availableResult, donatedResult] = await requestsRef.current;
    if (signal.cancelled) return;

    if (availableResult.status === 'fulfilled') {
      try {
        const available = readProductList(availableResult.value);
        setProducts(available.items);
        setProductsState({ loading: false, error: '' });
        setStats((current) => ({ ...current, available: available.total }));
      } catch (error) {
        setProducts([]);
        setProductsState({ loading: false, error: error.message });
        setStats((current) => ({ ...current, available: null }));
      }
    } else {
      setProducts([]);
      setProductsState({ loading: false, error: availableResult.reason.message });
      setStats((current) => ({ ...current, available: null }));
    }

    if (donatedResult.status === 'fulfilled') {
      try {
        const donated = readProductList(donatedResult.value);
        setStats((current) => ({ ...current, donated: donated.total, loading: false }));
      } catch {
        setStats((current) => ({ ...current, donated: null, loading: false }));
      }
    } else {
      setStats((current) => ({ ...current, donated: null, loading: false }));
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    loadHomeData(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadHomeData, reloadKey]);

  return (
    <div className="home-page">
      <Header />

      <main>
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="home-hero__content">
            <h1 id="home-hero-title">
              O que não serve mais para você pode ser útil para alguém. ♻️
            </h1>
            <p>
              Doe objetos que você não utiliza mais para pessoas da sua própria comunidade.
            </p>
            <div className="home-hero__actions">
              <Button as={Link} to="/doar" variant="primary" className="home-hero__donate">
                Quero Doar!
              </Button>
              <Button as={Link} to="/explorar" variant="outline" className="home-hero__explore">
                Explorar Doações
              </Button>
            </div>
          </div>
        </section>

        <section className="home-section home-how" id="como-funciona" aria-labelledby="home-how-title">
          <div className="home-section__heading">
            <span className="home-eyebrow">Simples e comunitário</span>
            <h2 id="home-how-title">Como funciona?</h2>
            <p>Três passos para dar um novo ciclo aos seus itens.</p>
          </div>
          <div className="home-steps">
            {HOW_IT_WORKS.map((step) => (
              <article className="home-step" key={step.number}>
                <div className="home-step__top">
                  <span className="home-step__number">{step.number}</span>
                  <span className="home-step__icon-wrap"><StepIcon name={step.icon} /></span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section home-recent" aria-labelledby="home-recent-title">
          <div className="home-section__title-row">
            <div>
              <span className="home-eyebrow">Novas oportunidades</span>
              <h2 id="home-recent-title">Doações recentes</h2>
            </div>
            <Button as={Link} to="/explorar" variant="outline">Explorar todas</Button>
          </div>

          {productsState.loading ? (
            <div className="home-state" role="status" aria-live="polite">
              <span className="home-state__spinner" aria-hidden="true" />
              <p>Carregando doações recentes…</p>
            </div>
          ) : productsState.error ? (
            <div className="home-state home-state--error" role="alert">
              <p>{productsState.error}</p>
              <Button variant="outline" onClick={() => {
                requestsRef.current = null;
                setReloadKey((key) => key + 1);
              }}>
                Tentar novamente
              </Button>
            </div>
          ) : products.length === 0 ? (
            <div className="home-state">
              <p className="home-state__empty-title">Ainda não há doações disponíveis.</p>
              <p>Quando novas publicações forem cadastradas, elas aparecerão aqui.</p>
            </div>
          ) : (
            <div className="home-products">
              {products.map((product) => (
                <ProductCard
                  key={product._id || product.id}
                  product={product}
                  detailsTo={`/produtos/${product._id || product.id}`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="home-community" aria-labelledby="home-community-title">
          <div className="home-community__heading">
            <span className="home-eyebrow">Impacto coletivo</span>
            <h2 id="home-community-title">Uma comunidade que compartilha</h2>
          </div>
          <div className="home-community__stats">
            <article className="home-stat">
              <span className="home-stat__value">
                {stats.loading ? '—' : stats.donated?.toLocaleString('pt-BR') ?? '—'}
              </span>
              <span className="home-stat__label">Doações realizadas</span>
            </article>
            <article className="home-stat">
              <span className="home-stat__value">
                {stats.loading ? '—' : stats.available?.toLocaleString('pt-BR') ?? '—'}
              </span>
              <span className="home-stat__label">Itens disponíveis</span>
            </article>
            <article className="home-stat">
              <span className="home-stat__value">—</span>
              <span className="home-stat__label">Pessoas na comunidade</span>
            </article>
          </div>
          <p className="home-community__note">
            Os números de doações e itens disponíveis vêm das publicações cadastradas.
            O total de participantes ainda não é fornecido pela API.
          </p>
        </section>
      </main>

    </div>
  );
}
