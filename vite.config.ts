import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative paths, so the same build works at a domain's root or under username.github.io/repo/
  base: './',
  plugins: [react()],
});
