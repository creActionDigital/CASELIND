import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiOperations } from '../src/openapi/registry.js';
import { createTestContext, type TestContext } from './helpers.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface ExpressLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

/** Every method+path Express actually serves, in OpenAPI path form (`:id` → `{id}`). */
function mountedRoutes(ctx: TestContext): Set<string> {
  const instance = ctx.app.getHttpAdapter().getInstance() as { router: { stack: ExpressLayer[] } };
  const routes = new Set<string>();
  for (const layer of instance.router.stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const rawPath of paths) {
      // Nest's global 404 handler is mounted as a catch-all (`/v1{/*splat}`, every method). No
      // controller declares a wildcard route, so wildcards are never API operations.
      if (rawPath.includes('*')) continue;
      const path = rawPath.replace(/:(\w+)/g, '{$1}');
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled) continue;
        if (method === '_all') throw new Error(`ALL route ${rawPath} cannot be described in the registry`);
        routes.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return routes;
}

describe('OpenAPI document', () => {
  let ctx: TestContext;
  let doc: Record<string, any>;

  beforeAll(async () => {
    ctx = await createTestContext();
    const res = await ctx.http.get('/v1/openapi.json').expect(200);
    doc = res.body;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('is a public OpenAPI 3.1 document exposing the register request schema', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('CASELIND API');
    const register = doc.paths['/v1/auth/register'].post;
    const schema = register.requestBody.content['application/json'].schema;
    expect(schema.properties).toHaveProperty('identifier');
    expect(schema.required).toContain('identifier');
    expect(register.responses['202']).toBeDefined();
    expect(doc.components.schemas.ApiError.properties).toHaveProperty('error');
  });

  it('describes exactly the routes that are mounted (both ways)', () => {
    const mounted = mountedRoutes(ctx);
    const registered = new Set(apiOperations.map((op) => `${op.method.toUpperCase()} ${op.path}`));
    const inDoc = new Set(
      Object.entries(doc.paths as Record<string, Record<string, unknown>>).flatMap(([path, item]) =>
        METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`),
      ),
    );

    const missingFromRegistry = [...mounted].filter((r) => !registered.has(r)).sort();
    const notMounted = [...registered].filter((r) => !mounted.has(r)).sort();
    expect(
      { missingFromRegistry, notMounted },
      `registry drift:\n  mounted but not registered: ${missingFromRegistry.join(', ') || '-'}\n  registered but not mounted: ${notMounted.join(', ') || '-'}`,
    ).toEqual({ missingFromRegistry: [], notMounted: [] });
    expect([...inDoc].sort()).toEqual([...registered].sort());
  });

  it('requires a bearer token on every non-public operation', () => {
    for (const op of apiOperations) {
      const operation = doc.paths[op.path][op.method];
      if (op.auth === 'public') {
        expect(operation.security, `${op.method} ${op.path}`).toBeUndefined();
      } else {
        expect(operation.security, `${op.method} ${op.path}`).toEqual([{ bearer: [] }]);
      }
      if (op.auth === 'admin') expect(operation.description).toMatch(/admin/);
      if (op.auth === 'moderator') expect(operation.description).toMatch(/`admin` or `moderator`/);
    }
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('expands query objects into parameters', () => {
    const params = doc.paths['/v1/blocks'].get.parameters as { name: string; in: string }[];
    expect(params.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(expect.arrayContaining(['limit', 'cursor']));
  });

  it('never mentions secrets', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('code_hash');
  });
});
