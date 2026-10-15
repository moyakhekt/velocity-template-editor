import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { VelocityPreviewProvider } from '../preview';

/**
 * The preview server is reachable by any web page the user has open, so it must
 * only serve files under the template root, only to requests addressed to it by
 * name, and never to other sites.
 */
describe('preview server security', () => {
    let tmp: string;
    let provider: VelocityPreviewProvider;
    let port: number;

    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtl-preview-'));
        const templateDir = path.join(tmp, 'project', 'conf', 'template');
        fs.mkdirSync(templateDir, { recursive: true });
        fs.writeFileSync(path.join(templateDir, 'style.css'), 'body{}');
        fs.writeFileSync(path.join(tmp, 'project', 'conf', 'shared.css'), 'p{}'); // parent fallback
        fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET');

        const context = { globalStorageUri: { fsPath: tmp }, extensionPath: tmp } as any;
        provider = new VelocityPreviewProvider(context, {} as any);
        const internals = provider as any;
        await internals.startPreviewServer(tmp);
        internals.templateDir = templateDir;
        port = internals.serverPort;
    });

    afterAll(() => {
        provider.dispose();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function get(rawPath: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
        return new Promise((resolve, reject) => {
            const req = http.request({ host: 'localhost', port, path: rawPath, headers: { host: `localhost:${port}`, ...headers } }, res => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
            });
            req.on('error', reject);
            req.end();
        });
    }

    it('serves assets from the template root and its parent', async () => {
        const css = await get('/style.css');
        expect(css.status).toBe(200);
        expect(css.body).toBe('body{}');
        expect(css.headers['access-control-allow-origin']).toBeUndefined();
        expect((await get('/shared.css')).body).toBe('p{}');
    });

    it.each([
        '/../../../secret.txt',
        '/..%2F..%2F..%2Fsecret.txt',
        '/..%5C..%5C..%5Csecret.txt',
        '/%2E%2E/%2E%2E/%2E%2E/secret.txt',
    ])('refuses to leave the template root: %s', async rawPath => {
        const res = await get(rawPath);
        expect(res.status).toBe(404);
        expect(res.body).not.toContain('SECRET');
    });

    it('rejects malformed escapes', async () => {
        expect((await get('/%E0%A4%A')).status).toBe(400);
    });

    it('rejects requests addressed to another host name (DNS rebinding)', async () => {
        expect((await get('/style.css', { host: `attacker.example:${port}` })).status).toBe(403);
    });

    it.each(['cross-site', 'same-site'])('rejects %s requests from other pages', async site => {
        expect((await get('/style.css', { 'sec-fetch-site': site })).status).toBe(403);
        expect((await get('/__open-template?which=primary', { 'sec-fetch-site': site })).status).toBe(403);
    });

    it.each(['same-origin', 'none'])('allows %s requests', async site => {
        expect((await get('/style.css', { 'sec-fetch-site': site })).status).toBe(200);
    });
});
