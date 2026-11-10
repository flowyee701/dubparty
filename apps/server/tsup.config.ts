import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Общий пакет поставляется исходниками на TypeScript, поэтому вшиваем его в бандл.
  noExternal: ['@dubparty/shared'],
});
