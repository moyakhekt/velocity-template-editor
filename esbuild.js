const esbuild = require('esbuild');
const { watch } = require('fs');

const production = process.argv.includes('--production');
const watchMode = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'watch-plugin',
        setup(build) {
          build.onEnd(result => {
            console.log(`[watch] build finished, ${result.errors.length} errors`);
          });
        },
      },
    ],
  });

  if (watchMode) {
    await ctx.watch();
    console.log('[watch] build started');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] build complete');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
