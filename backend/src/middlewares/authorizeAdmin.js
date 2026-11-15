import { ObjectId } from 'mongodb';

export function authorizeAdmin(req, res, next) {
  const configuredIds = process.env.ADMIN_USER_IDS;
  if (!configuredIds?.trim()) {
    return res.status(403).send({
      success: false,
      statusCode: 403,
      body: 'As operações administrativas não estão habilitadas.'
    });
  }

  const adminIds = configuredIds.split(',').map((id) => id.trim()).filter(Boolean);
  if (!adminIds.length || adminIds.some((id) => !/^[a-f\d]{24}$/i.test(id) || !ObjectId.isValid(id))) {
    return res.status(500).send({
      success: false,
      statusCode: 500,
      body: 'A configuração ADMIN_USER_IDS contém um identificador inválido.'
    });
  }

  if (!req.user || !adminIds.some((id) => id.toLowerCase() === req.user.id.toLowerCase())) {
    return res.status(403).send({
      success: false,
      statusCode: 403,
      body: 'Apenas administradores autorizados podem executar esta operação.'
    });
  }

  return next();
}
