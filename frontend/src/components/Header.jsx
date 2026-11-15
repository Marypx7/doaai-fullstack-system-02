import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Button from './Button.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import logo from '../assets/logo-doaai.svg';
import './Header.css';

const defaultLinks = [
  { label: 'Explorar doações', to: '/explorar' },
  { label: 'Meus Favoritos', to: '/favoritos' }
];

export default function Header({
  navItems = defaultLinks,
  donateTo = '/doar'
}) {
  const { user, openLogin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" to="/" aria-label="DoaAí, página inicial" onClick={closeMenu}>
          <img src={logo} alt="" />
        </Link>

        <button
          className="site-header__menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>

        <div
          className={`site-header__content${menuOpen ? ' site-header__content--open' : ''}`}
          id="primary-navigation"
        >
          <nav className="site-header__nav" aria-label="Navegação principal">
            {navItems.map(({ label, to }) => (
              <NavLink
                key={`${label}-${to}`}
                to={to}
                className={({ isActive }) => `site-header__link${isActive ? ' is-active' : ''}`}
                onClick={closeMenu}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="site-header__actions">
            <Button
              as={Link}
              to={donateTo}
              variant="primary"
              className="site-header__donate"
              onClick={closeMenu}
            >
              Quero Doar!
            </Button>
            {user ? (
              <div className="site-header__account">
                <Link to="/perfil" className="site-header__profile" onClick={closeMenu}>
                  <span className="site-header__profile-icon" aria-hidden="true" />
                  <span>Perfil</span>
                </Link>
                <Button
                  variant="outline"
                  className="site-header__signout"
                  onClick={() => { closeMenu(); signOut(); }}
                >
                  Sair
                </Button>
              </div>
            ) : (
              <button
                className="site-header__profile site-header__profile--button"
                type="button"
                onClick={() => { closeMenu(); openLogin(); }}
              >
                <span className="site-header__profile-icon" aria-hidden="true" />
                <span>Perfil</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
