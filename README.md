# DoaAí

O DoaAí é uma plataforma para aproximar pessoas que desejam doar de quem procura itens para reutilizar. A aplicação permite publicar e explorar doações, acompanhar publicações próprias, favoritar itens e denunciar conteúdo.

O repositório GitHub é [`Marypx7/doaai-fullstack-system-02`](https://github.com/Marypx7/doaai-fullstack-system-02).

## Tecnologias

- **Frontend:** React 19, Vite e React Router.
- **Backend:** Node.js 20 ou superior e Express.
- **Dados:** MongoDB, usando o driver nativo.
- **Autenticação:** JWT e fluxos opcionais de login social por OAuth.
- **Serviços integráveis:** Cloudinary para imagens e SMTP para e-mails.

## Organização

- [`frontend/`](./frontend/) contém a aplicação React, páginas, componentes, estilos e a configuração de build.
- [`backend/`](./backend/) contém a API, autenticação, integração com MongoDB, modelos, rotas e testes.
- [`backend/README.md`](./backend/README.md) documenta as variáveis de ambiente, rotas e detalhes técnicos do backend.
- [`.github/workflows/`](./.github/workflows/) contém o workflow manual para preparar a publicação do frontend no GitHub Pages.

O GitHub Pages hospeda somente o frontend. O backend precisa ser hospedado separadamente; configure `VITE_API_URL` como uma variável pública do repositório, apontando para a URL HTTPS da API. Não coloque credenciais ou segredos em variáveis `VITE_*`, pois seus valores são incluídos no bundle do navegador.

## Desenvolvimento local

Use Node.js 20 ou superior.

### Backend

Configure as variáveis necessárias em `backend/.env`, conforme [`backend/README.md`](./backend/README.md), e então execute:

```sh
cd backend
npm ci
npm run dev
```

### Frontend

Configure `VITE_API_URL` em `frontend/.env` para apontar à API local e execute:

```sh
cd frontend
npm ci
npm run dev
```

Os arquivos `.env` são locais e não devem ser versionados. O arquivo [`frontend/.env.example`](./frontend/.env.example) contém somente um exemplo de URL local.
