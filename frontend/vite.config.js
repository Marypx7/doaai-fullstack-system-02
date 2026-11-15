import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/doaai-fullstack-system-02/' : '/',
  plugins: [react()]
}));
