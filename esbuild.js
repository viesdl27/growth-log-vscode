// 构建脚本：将 src/extension.ts 打包为 dist/extension.js（vscode 作为外部依赖不打包）
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  esbuild.context(options).then((ctx) => ctx.watch()).catch(() => process.exit(1));
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
