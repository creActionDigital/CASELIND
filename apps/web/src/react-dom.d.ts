// @types/react-dom is not installed (kept out to avoid a new dependency); only what main.tsx uses.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export function createRoot(el: Element): { render(node: ReactNode): void };
}
