export const USERS_COLLECTION = 'users';

export function createUserDocument({ name, email, password, salt, neighborhood, socialAccounts }) {
  const now = new Date();
  return {
    name,
    email,
    ...(typeof password === 'string' && typeof salt === 'string' ? { password, salt } : {}),
    ...(socialAccounts && typeof socialAccounts === 'object' ? { socialAccounts } : {}),
    neighborhood,
    authVersion: 0,
    createdAt: now,
    updatedAt: now
  };
}