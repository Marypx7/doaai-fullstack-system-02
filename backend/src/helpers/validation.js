export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export const requiredText = (value, maxLength = 500) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const publicUser = (user) => {
  if (!user) return user;
  const { password, salt, authVersion, socialAccounts, ...safeUser } = user;
  return safeUser;
};
