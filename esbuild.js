const esbuild = require('esbuild');
const { watch } = require('fs');
const fs = require('fs-extra');
const path = require('path');

const production = process.argv.includes('--production');
const watchMode = process.argv.includes('--watch');

// Plugin to copy template files
const copyTemplatesPlugin = {
  name: 'copy-templates',
  setup(build) {
    build.onEnd(async () => {
      const srcTemplates = path.join(__dirname, 'webview-ui');
      const outTemplates = path.join(__dirname, 'out', 'webview-ui');
      
      try {
        await fs.ensureDir(outTemplates);
        await fs.copy(srcTemplates, outTemplates, { overwrite: true });
        console.log('[copy] webview-ui copied');
      } catch (err) {
        console.error('[copy] failed to copy webview-ui:', err);
      }

      // Codicons are a dev dependency, so node_modules isn't packaged with them:
      // ship the stylesheet and its font (referenced by the CSS) from out/
      try {
        const srcCodicons = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
        const outCodicons = path.join(__dirname, 'out', 'codicons');
        await fs.ensureDir(outCodicons);
        for (const file of ['codicon.css', 'codicon.ttf']) {
          await fs.copy(path.join(srcCodicons, file), path.join(outCodicons, file), { overwrite: true });
        }
        console.log('[copy] codicons copied');
      } catch (err) {
        console.error('[copy] failed to copy codicons:', err);
      }
    });
  }
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['extension/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode', 'playwright-core'],
    logLevel: 'silent',
    plugins: [
      copyTemplatesPlugin,
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
