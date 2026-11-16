import { defineConfig } from 'vite';

// Vite 8 compiles JSX with its built-in transformer: no React plugin is needed (fast refresh is the only thing given up).
export default defineConfig({ oxc: { jsx: { runtime: 'automatic' } }, build: { target: 'es2022' } });
