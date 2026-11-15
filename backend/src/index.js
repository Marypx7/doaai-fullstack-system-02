// Este arquivo é o ponto de entrada do backend da aplicação.
// Ele cria o servidor web, conecta com o banco de dados e define as rotas
// que o frontend vai chamar para acessar as funcionalidades do sistema.

import { Mongo } from './database/mongo.js'; // Importa a lógica de conexão com o MongoDB
import { config } from 'dotenv'; // Carrega variáveis do arquivo .env
import { createApp } from './app.js';

// Carrega as variáveis de ambiente escondidas (como usuário, senha e nome do banco)
config();

// Função principal: tudo começa aqui
async function main() {
    // Endereço local do servidor: normalmente o computador do próprio desenvolvedor
    const hostname = process.env.HOST || "localhost";

    // Porta em que o backend vai ficar ouvindo
    const port = Number(process.env.PORT) || 3000;

    const app = createApp();

    const server = app.listen(port, hostname, () => {
        console.log(`Server running on: http://${hostname}:${port}`);
    });

    server.on('error', (error) => {
        console.error(`Não foi possível iniciar o servidor em http://${hostname}:${port}:`, error.message);
        process.exitCode = 1;
    });

    try {
        const mongoConnection = await Mongo.connect({
            mongoConnectionString: process.env.MONGO_CS,
            mongoDbName: process.env.MONGO_DB_NAME
        });
        console.log(`MongoDB conectado ao banco ${mongoConnection.databaseName}.`);
    } catch (error) {
        console.error('Erro ao conectar ao MongoDB:', error.message);
        console.error('A API continuará disponível para /api/health; as demais rotas responderão 503 até o banco estar disponível.');
    }
}

// Executa a função principal para iniciar tudo
main();