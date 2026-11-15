export const REPORTS_COLLECTION = 'reports';
export const REPORT_STATUSES = ['pendente', 'em_analise', 'resolvida', 'rejeitada'];
export const REPORT_REASONS = [
  'Produto proibido',
  'Informações falsas',
  'Publicação duplicada',
  'Conteúdo inadequado',
  'Outros'
];

export function createReportDocument({ reporterId, productId, reason, description, createdAt = new Date() }) {
  return {
    reporterId,
    productId,
    reason,
    description,
    status: 'pendente',
    emailStatus: 'sending',
    dedupeKey: `${reporterId}:${productId}:${createdAt.toISOString().slice(0, 10)}`,
    createdAt
  };
}
