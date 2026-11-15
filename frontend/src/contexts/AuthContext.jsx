import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const AuthContext = createContext(null);
const STORAGE_KEY = 'doaai.auth';

function readStoredSession() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored);
    if (typeof session?.token !== 'string' || !session.user || typeof session.user !== 'object') {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const payloadPart = session.token.split('.')[1];
    if (!payloadPart) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const binaryPayload = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const payloadBytes = Uint8Array.from(binaryPayload, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { token: session.token, user: session.user };
  } catch {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession);
  const [authModal, setAuthModal] = useState(null);

  const signIn = useCallback(({ token, user }) => {
    if (typeof token !== 'string' || !token || !user || typeof user !== 'object') {
      throw new Error('A resposta de autenticação não contém sessão válida.');
    }
    const nextSession = { token, user };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    setAuthModal(null);
  }, []);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setAuthModal(null);
  }, []);

  const updateUserProfile = useCallback((profile) => {
    setSession((current) => {
      if (!current) return current;
      const updates = {};
      for (const field of ['name', 'email', 'neighborhood']) {
        if (typeof profile?.[field] === 'string') updates[field] = profile[field];
      }
      if (Object.keys(updates).length === 0) return current;

      const nextSession = {
        ...current,
        user: { ...current.user, ...updates }
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      return nextSession;
    });
  }, []);

  const openLogin = useCallback(() => setAuthModal('login'), []);
  const openSignup = useCallback(() => setAuthModal('signup'), []);
  const closeAuthModal = useCallback(() => setAuthModal(null), []);

  const value = useMemo(() => ({
    token: session?.token || null,
    user: session?.user || null,
    updateUserProfile,
    authModal,
    signIn,
    signOut,
    openLogin,
    openSignup,
    closeAuthModal
  }), [session, authModal, signIn, signOut, updateUserProfile, openLogin, openSignup, closeAuthModal]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
