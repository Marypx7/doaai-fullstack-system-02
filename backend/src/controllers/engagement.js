import { ObjectId } from 'mongodb';
import EngagementDataAccess from '../dataAccess/engagement.js';
import ProductDataAccess from '../dataAccess/produtoDataAccess.js';
import { Mongo } from '../database/mongo.js';
import { createReportDocument, REPORT_REASONS, REPORT_STATUSES } from '../models/Report.js';
import { sendReportEmail } from '../config/email.js';
import { isObjectId } from '../helpers/validation.js';
import { notFound, ok, serverError } from '../helpers/httpResponse.js';

const dataAccess = new EngagementDataAccess();
const productDataAccess = new ProductDataAccess();
const invalid = (body) => ({ success: false, statusCode: 400, body });

export default class EngagementController {
  async listFavorites(userId) {
    try {
      return ok(await dataAccess.listFavorites(userId));
    } catch (error) {
      return serverError(error);
    }
  }

  async addFavorite(userId, productId) {
    if (!isObjectId(productId)) return invalid('ID de produto inválido.');
    try {
      const product = await productDataAccess.findPublicById(productId);
      if (!product) return notFound();
      await dataAccess.addFavorite(userId, productId);
      return { success: true, statusCode: 201, body: { message: 'Produto adicionado aos favoritos.' } };
    } catch (error) {
      if (error.code === 11000) return { success: false, statusCode: 409, body: 'Produto já está nos favoritos.' };
      return serverError(error);
    }
  }

  async removeFavorite(userId, productId) {
    if (!isObjectId(productId)) return invalid('ID de produto inválido.');
    try {
      const deletedCount = await dataAccess.removeFavorite(userId, productId);
      return deletedCount ? ok({ message: 'Produto removido dos favoritos.' }) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }

  async createReport(userId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Corpo da requisição inválido.');
    const allowedFields = new Set(['productId', 'reason', 'description']);
    if (Object.keys(body).some((field) => !allowedFields.has(field))) {
      return invalid('A denúncia contém campos não permitidos.');
    }
    if (!isObjectId(body.productId)) return invalid('ID de publicação inválido.');
    if (typeof body.reason !== 'string' || !REPORT_REASONS.includes(body.reason)) {
      return invalid('Selecione um motivo válido para a denúncia.');
    }
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 1000)) {
      return invalid('Descrição da denúncia inválida.');
    }

    let report;
    try {
      const product = await Mongo.db.collection('products').findOne({ _id: new ObjectId(body.productId) });
      if (!product) return notFound();

      const now = new Date();
      const rateLimitStart = new Date(now.getTime() - 60 * 60 * 1000);
      if (await dataAccess.countReportsSince(userId, rateLimitStart) >= 5) {
        return { success: false, statusCode: 429, body: 'Limite de denúncias atingido. Tente novamente mais tarde.' };
      }

      const reporterObjectId = new ObjectId(userId);
      const productObjectId = new ObjectId(body.productId);
      const candidate = createReportDocument({
        reporterId: reporterObjectId,
        productId: productObjectId,
        reason: body.reason,
        description: body.description?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() || '',
        createdAt: now
      });
      const existing = await dataAccess.findReportByDedupeKey(candidate.dedupeKey);
      if (existing && existing.emailStatus !== 'failed') {
        return { success: false, statusCode: 409, body: 'Esta publicação já foi denunciada por você hoje.' };
      }

      if (existing) {
        const claim = await dataAccess.claimFailedReport(existing._id);
        if (!claim.modifiedCount) {
          return { success: false, statusCode: 409, body: 'Esta denúncia já está sendo processada.' };
        }
        report = { ...existing, emailStatus: 'sending' };
      } else {
        try {
          report = await dataAccess.createReport(candidate);
        } catch (error) {
          if (error.code === 11000) {
            return { success: false, statusCode: 409, body: 'Esta publicação já foi denunciada por você hoje.' };
          }
          throw error;
        }
      }

      try {
        await sendReportEmail({ report, product, reporterId: userId });
        await dataAccess.updateReportEmailStatus(report._id, 'sent');
      } catch (error) {
        try {
          await dataAccess.updateReportEmailStatus(report._id, 'failed');
        } catch (persistError) {
          console.error('Não foi possível registrar a falha no envio do e-mail da denúncia:', persistError);
        }
        console.error('Não foi possível enviar o e-mail da denúncia:', error);
        return {
          success: false,
          statusCode: 502,
          body: {
            message: 'Não foi possível enviar sua denúncia.',
            detail: 'Tente novamente em alguns instantes.'
          }
        };
      }

      return {
        success: true,
        statusCode: 201,
        body: {
          message: 'Denúncia enviada com sucesso!',
          detail: 'Obrigado por nos ajudar a manter o DoaAí um ambiente seguro. Nossa equipe analisará sua denúncia.'
        }
      };
    } catch (error) {
      if (error.code === 11000) {
        return { success: false, statusCode: 409, body: 'Esta publicação já foi denunciada por você hoje.' };
      }
      return serverError(error);
    }
  }

  async listReports(userId) {
    try {
      return ok(await dataAccess.listReports(userId));
    } catch (error) {
      return serverError(error);
    }
  }

  async listAllReports() {
    try {
      return ok(await dataAccess.listAllReports());
    } catch (error) {
      return serverError(error);
    }
  }

  async updateReportStatus(id, body) {
    if (!isObjectId(id)) return invalid('ID de denúncia inválido.');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'status') ||
        !REPORT_STATUSES.includes(body.status)) {
      return invalid(`Informe um status válido: ${REPORT_STATUSES.join(', ')}.`);
    }
    try {
      const report = await dataAccess.updateReportStatus(id, body.status);
      return report ? ok(report) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }
}
