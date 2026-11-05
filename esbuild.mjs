// Bundles the extension into a single CommonJS file so node_modules is not shipped.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  // jsonc-parser's default UMD build loads './impl/*' with a runtime require that esbuild cannot
  // follow; its ES-module build bundles cleanly.
  mainFields: ['module', 'main'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
