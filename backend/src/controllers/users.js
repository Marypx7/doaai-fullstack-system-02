import UsersDataAccess from "../dataAccess/users.js"
import { ok, notFound, serverError } from '../helpers/httpResponse.js'
import { requiredText } from '../helpers/validation.js'

export default class UsersControllers {
    constructor() {
        this.dataAccess = new UsersDataAccess();
    }

    async getUsers() {
        try {
            const users = await this.dataAccess.getUsers();

            return ok(users);

        } catch (error) {
            return serverError(error);
        }
    }

    async getMe(userId) {
        try {
            const user = await this.dataAccess.findUserById(userId);
            return user ? ok(user) : notFound();
        } catch (error) {
            return serverError(error);
        }
    }

     async deleteUser(userId, requesterId) {
        if (!/^[a-f\d]{24}$/i.test(userId)) {
            return {
                success: false,
                statusCode: 400,
                body: 'ID de usuário inválido.'
            };
        }
        if (userId.toLowerCase() !== requesterId.toLowerCase()) {
            return { success: false, statusCode: 403, body: 'Você não pode excluir outra conta.' };
        }

        try {
            const deletedCount = await this.dataAccess.deleteUser(userId);
            if (deletedCount === 0) {
                return notFound();
            }
            return ok({ message: 'Usuário excluído com sucesso.' });

        } catch (error) {
            return serverError(error);
        }
    }

    async updateUser(userId, userData, requesterId) {
        if (!/^[a-f\d]{24}$/i.test(userId)) {
            return {
                success: false,
                statusCode: 400,
                body: 'ID de usuário inválido.'
            };
        }
        if (userId.toLowerCase() !== requesterId.toLowerCase()) {
            return { success: false, statusCode: 403, body: 'Você não pode alterar outra conta.' };
        }

        if (!userData || typeof userData !== 'object' || Array.isArray(userData)) {
            return {
                success: false,
                statusCode: 400,
                body: 'Informe um email ou uma senha para atualizar.'
            };
        }
        const allowedFields = new Set(['email', 'password', 'name', 'neighborhood']);
        if (Object.keys(userData).some((field) => !allowedFields.has(field))) {
            return { success: false, statusCode: 400, body: 'A atualização contém campos não permitidos.' };
        }

        const updates = {};

        if (userData.email !== undefined) {
            if (typeof userData.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email.trim())) {
                return {
                    success: false,
                    statusCode: 400,
                    body: 'Email inválido.'
                };
            }
            updates.email = userData.email.trim().toLowerCase();
        }

        if (userData.password !== undefined) {
            if (typeof userData.password !== 'string' || userData.password.length < 8) {
                return { success: false, statusCode: 400, body: 'Senha deve conter pelo menos 8 caracteres.' };
            }
            updates.password = userData.password;
        }

        if (userData.name !== undefined) {
            if (!requiredText(userData.name, 100)) {
                return { success: false, statusCode: 400, body: 'Nome inválido.' };
            }
            updates.name = userData.name.trim();
        }

        if (userData.neighborhood !== undefined) {
            if (typeof userData.neighborhood !== 'string' || userData.neighborhood.length > 120) {
                return { success: false, statusCode: 400, body: 'Bairro/região inválido.' };
            }
            updates.neighborhood = userData.neighborhood.trim();
        }

        if (Object.keys(updates).length === 0) {
            return {
                success: false,
                statusCode: 400,
                body: 'Informe um email ou uma senha para atualizar.'
            };
        }

        try {
            const matchedCount = await this.dataAccess.updateUser(userId, updates);

            if (matchedCount === 0) {
                return notFound();
            }

            return ok({ message: 'Usuário atualizado com sucesso.' });
        } catch (error) {
            if (error.code === 11000) {
                return { success: false, statusCode: 409, body: 'E-mail já cadastrado.' };
            }
            return serverError(error);
        }
    }

}