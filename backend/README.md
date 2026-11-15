# DoaAí — Backend

API REST em Node.js/Express usando o driver nativo do MongoDB. O backend requer Node.js 20 ou superior.

## Configuração

Configure no `.env`:

```env
MONGO_CS=
MONGO_DB_NAME=
JWT_SECRET=
ADMIN_USER_IDS=
PORT=3000
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
EMAIL_MODE=smtp
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
PUBLIC_APP_URL=
FRONTEND_URL=
BACKEND_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT=common
# Opcional: FACEBOOK_GRAPH_VERSION=v26.0
# Opcional: GOOGLE_CALLBACK_URL, FACEBOOK_CALLBACK_URL, MICROSOFT_CALLBACK_URL
```

`JWT_SECRET` é obrigatório para cadastro/login e deve ter pelo menos 32 caracteres aleatórios. `ADMIN_USER_IDS` é uma lista separada por vírgula de IDs MongoDB de usuários confiáveis; somente essas contas podem gerenciar categorias. Sem essa configuração, o gerenciamento fica desativado e retorna `403`. Não existe promoção a administrador pelo cadastro. As três chaves do Cloudinary são necessárias somente para upload de fotografias. Não compartilhe nem versione credenciais.

Inicie com `npm run dev` dentro da pasta `backend`. As rotas estão disponíveis sob `/api`; os caminhos anteriores sem esse prefixo continuam ativos. `GET /api/health` não depende do MongoDB. O servidor inicia mesmo se o banco estiver indisponível: nesse caso, as rotas que usam dados respondem `503` até o banco conectar. Na primeira conexão, índices são criados nas coleções `users`, `products`, `categories`, `favorites`, `reports`, `socialAuthTransactions` e `socialAuthExchangeCodes`. O índice único de e-mail pressupõe que os dados existentes não tenham e-mails duplicados. Os registros de fluxo OAuth e códigos de troca são temporários e expiram automaticamente.

## Rotas

- `GET /api/health`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/auth/google`, `GET /api/auth/google/callback`; `GET /api/auth/facebook`, `GET /api/auth/facebook/callback`; `GET /api/auth/microsoft`, `GET /api/auth/microsoft/callback`
- `POST /api/auth/social/exchange` troca um código de uso único (com validade de 60 segundos) por uma sessão DoaAí. O código de troca não é JWT nem token do provedor; o JWT da aplicação é devolvido somente no corpo da resposta.
- `POST /api/auth/:provider/link` (autenticado) inicia a vinculação explícita de um provedor à conta já autenticada.
- `GET /api/users`; `PUT /api/users/:id` e `DELETE /api/users/:id` (autenticados, somente a própria conta)
- `GET /api/products` e `GET /api/produtos` aceitam filtros combináveis: `busca` (texto em nome/descrição), `categoria` (slug como `moveis` ou ID; `category` é alias), `subcategoria`, `conservacao`, `bairro` (`neighborhood` é alias), `status`, `page`, `limit` (máximo 50) e `ordenacao` (`recentes` ou `antigos`; padrão `recentes`). Retornam itens mais novos primeiro por padrão, além do total, páginas e indicadores de navegação. A busca textual utiliza índice text do MongoDB; os demais filtros usam valores validados e expressões escapadas.
- Consultas públicas listam `disponivel` por padrão e excluem produtos marcados com `hidden`, `visible:false`, `visibility:'hidden'`/`'private'`, status de moderação `hidden`/`removed`/`deleted` ou `deletedAt`. `GET /api/products/:id` e `GET /api/produtos/:id`; `GET /api/products/mine` e `GET /api/produtos/mine` (autenticados, lista somente publicações do usuário do token; aceita `status=disponivel|reservado|doado` e retorna `summary` com o total geral e a quantidade por status, independentemente do filtro aplicado)
- `POST /api/products` e `POST /api/produtos`; `PUT /api/products/:id` e `PUT /api/produtos/:id` (autenticados; multipart com até cinco imagens JPEG/PNG/WEBP, assinatura do arquivo validada no backend, até 5 MB cada). Em `PUT`, envie `removePhotos` como uma lista JSON de `publicId`s para remover imagens específicas; novas imagens são acrescentadas por padrão. Para substituir a galeria inteira, envie `replacePhotos=true` (não junto com `removePhotos`). A operação verifica a propriedade antes de alterar ou excluir imagens do Cloudinary. `DELETE /api/products/:id` e `DELETE /api/produtos/:id` também removem as fotografias da publicação; falhas de remoção são reportadas e as imagens ainda existentes permanecem associadas ao produto. `PATCH /api/products/:id/status` e `PATCH /api/produtos/:id/status` (autenticados, somente proprietário)
- Status de doação: `disponivel`, `reservado` e `doado`. O status pode ser alterado no `PATCH` com `{ "status": "reservado" }` ou no `PUT` da publicação. Publicações antigas com status em inglês são migradas automaticamente na inicialização.
- As rotas de produtos também estão disponíveis em `/produtos`.
- `GET /api/categories`, `GET /api/categories/:slug` (públicos; somente categorias ativas)
- `GET /api/categories/admin`, `POST /api/categories`, `PUT /api/categories/:id`, `PATCH /api/categories/:id/status` (administradores configurados em `ADMIN_USER_IDS`). `PUT` edita nome/subcategorias e atualiza o slug; `PATCH` recebe `{ "active": true|false }`.
- `GET /api/favorites`, `POST /api/favorites/:productId`, `DELETE /api/favorites/:productId` (autenticados)
- `GET /api/reports`, `POST /api/reports` (autenticados)

Na inicialização, as categorias Móveis, Roupas e acessórios, Eletrônicos, Livros, Brinquedos, Utilidades domésticas, Materiais escolares, Artigos infantis e Outros são inseridas somente se ainda não existirem; o seed não sobrescreve alterações nem ativa categorias desativadas. A categoria Móveis começa com as subcategorias Cadeiras, Mesas, Sofás, Armários e Camas. Produtos só podem selecionar subcategorias cadastradas na categoria ativa.

`POST /api/reports` recebe `{ "productId": "...", "reason": "Produto proibido", "description": "..." }` e exige autenticação. Os motivos aceitos são `Produto proibido`, `Informações falsas`, `Publicação duplicada`, `Conteúdo inadequado` e `Outros`; descrição é opcional e limitada a 1.000 caracteres. O produto e o denunciante são obtidos do banco e do token. O endpoint grava a denúncia e envia e-mail para `doaai@gmail.com`; o destinatário não pode ser definido pelo cliente. É permitido denunciar o mesmo produto uma vez por dia e o limite é de cinco denúncias por usuário a cada hora. Em falha de e-mail, a denúncia fica registrada e uma nova tentativa no mesmo dia pode reenviar o e-mail. O endpoint `GET /api/reports` permanece autenticado e lista somente as denúncias do próprio usuário.

Para SMTP, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` (ou `SMTP_USER`), e, se necessário, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_SECURE`. `PUBLIC_APP_URL` deve ser a URL pública do frontend e é usada para montar links enviados por e-mail. Para testes de desenvolvimento sem uma caixa real, configure `EMAIL_MODE=ethereal` ou use um SMTP local de desenvolvimento, como Mailpit. O e-mail de denúncia pode registrar uma pré-visualização Ethereal; o de recuperação não registra URLs nem tokens nos logs.

A recuperação recebe `{ "email": "..." }` em `POST /api/auth/forgot-password` e sempre responde com uma mensagem genérica para não revelar se a conta existe. O limite é de seis solicitações por IP a cada 15 minutos e uma solicitação aceita por conta a cada minuto. O token aleatório expira em 15 minutos; somente seu hash é armazenado. O link leva o token no fragmento `#token=...`, que não é enviado ao servidor web; o frontend o remove da barra de endereço ao carregá-lo e não o armazena em Web Storage. `POST /api/auth/reset-password` recebe `{ "token": "...", "password": "...", "passwordConfirmation": "..." }`, valida a confirmação, consome o token atomicamente e usa o mesmo PBKDF2 do cadastro. Após a redefinição, sessões JWT anteriores são invalidadas por uma versão interna da conta. Configure `PUBLIC_APP_URL` para a origem pública do frontend; em produção ela deve usar HTTPS. Os e-mails de recuperação usam o mesmo transporte SMTP/Ethereal, e o token não é impresso nos logs.

## Login social

Configure `FRONTEND_URL` e `BACKEND_URL` como origens públicas sem barra de caminho, credenciais, query string ou fragmento. Em produção, ambas devem usar HTTPS. As URLs de callback padrão são:

- Google: `${BACKEND_URL}/api/auth/google/callback`
- Facebook: `${BACKEND_URL}/api/auth/facebook/callback`
- Microsoft: `${BACKEND_URL}/api/auth/microsoft/callback`

Uma URL individual pode ser substituída por `GOOGLE_CALLBACK_URL`, `FACEBOOK_CALLBACK_URL` ou `MICROSOFT_CALLBACK_URL`. Cadastre exatamente a URL correspondente no console do provedor. `MICROSOFT_TENANT=common` aceita contas organizacionais e pessoais, incluindo Outlook/Hotmail; `consumers` restringe a contas pessoais, `organizations` a contas organizacionais, ou use um tenant específico.

O Google precisa de um cliente OAuth do tipo Web e dos escopos OpenID Connect `openid`, `email` e `profile`. O Facebook Login pede somente `email` e `public_profile`; o e-mail precisa estar disponível para criar a conta. O Microsoft Entra precisa de um registro de aplicativo que aceite o público escolhido, com permissões delegadas `openid`, `email` e `profile`; não é necessário acesso ao Microsoft Graph. A autenticação usa Authorization Code; Google e Microsoft também usam PKCE. IDs sociais são armazenados separadamente do e-mail, sem senha local ou tokens do provedor.

Um e-mail já usado por conta DoaAí nunca causa vinculação automática. O usuário deve entrar na conta existente, abrir Meu Perfil e iniciar uma vinculação explícita; o provedor é reautenticado após confirmação. Os identificadores de conta social não são incluídos nas respostas públicas do perfil. `state` fica vinculado a um cookie temporário `HttpOnly`, `SameSite` e `Secure` em produção; estados e códigos aleatórios são armazenados como hashes e expiram. Códigos de troca têm uso único. Não há login social disponível até que cada aplicativo e credencial do provedor seja configurado; o fluxo automatizado usa apenas respostas simuladas.

Exemplo de busca: `GET /api/produtos?categoria=moveis&subcategoria=cadeiras&bairro=tatuape&busca=madeira&page=1&limit=12`.

Envie `Authorization: Bearer <token>` nas rotas autenticadas. As respostas seguem o formato `{ success, statusCode, body }`. O cadastro aceita `name` (opcional para compatibilidade), `email`, `password` e `neighborhood`; produtos referenciam a categoria pelo campo `categoryId`.
