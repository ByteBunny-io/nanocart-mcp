import { build } from 'esbuild';
await build({
  entryPoints: ['src/lambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist-lambda/index.mjs',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('lambda bundle built');
