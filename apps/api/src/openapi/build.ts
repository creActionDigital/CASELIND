import { readFileSync } from 'node:fs';
import { apiErrorSchema } from '@caselind/contracts';
import { z } from 'zod';
import { type ApiOperation, apiOperations } from './registry.js';

type JsonSchema = Record<string, unknown>;
export type OpenApiDocument = Record<string, unknown> & { openapi: '3.1.0'; paths: Record<string, Record<string, unknown>> };

/** OpenAPI 3.1 uses JSON Schema 2020-12, zod's default target. bigint (audit cursor) travels as a decimal string. */
function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'bigint') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.pattern = '^[0-9]+$';
      }
    },
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

function apiVersion(): string {
  try {
    // src/openapi and dist/openapi are both two levels below apps/api.
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

/** Raw bytes: OpenAPI 3.1 describes a binary payload by its media type alone (empty schema, no encoding). */
function binaryContent(types: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(types.map((type) => [type, {}]));
}

function buildOperation(op: ApiOperation): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = [];
  for (const [, name] of op.path.matchAll(/\{(\w+)\}/g)) {
    const schema = op.params?.[name!];
    parameters.push({ name, in: 'path', required: true, schema: schema ? toSchema(schema, 'input') : { type: 'string' } });
  }
  for (const [name, schema] of Object.entries(op.headers ?? {})) {
    parameters.push({ name, in: 'header', required: true, schema: toSchema(schema, 'input') });
  }
  if (op.query) {
    const json = toSchema(op.query, 'input');
    const required = new Set((json.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries((json.properties as Record<string, JsonSchema> | undefined) ?? {})) {
      parameters.push({ name, in: 'query', required: required.has(name), schema });
    }
  }

  const description = [
    op.auth === 'admin' ? 'Requires the `admin` platform role (403 otherwise).' : undefined,
    op.auth === 'moderator' ? 'Requires the `admin` or `moderator` platform role (403 otherwise).' : undefined,
    op.auth !== 'public' ? 'Requires a bearer access token (401 otherwise).' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  const operation: Record<string, unknown> = {
    operationId: `${op.method}${op.path.replace(/^\/v1/, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase())}`,
    summary: op.summary,
    tags: op.tags,
    'x-auth': op.auth,
  };
  if (description) operation.description = description;
  if (parameters.length) operation.parameters = parameters;
  if (op.body) {
    operation.requestBody = { required: true, content: { 'application/json': { schema: toSchema(op.body, 'input') } } };
  } else if (op.rawBody) {
    operation.requestBody = { required: true, content: binaryContent(op.rawBody) };
  }
  operation.responses = {
    [String(op.status)]: op.response
      ? { description: 'Success', content: { 'application/json': { schema: toSchema(op.response, 'output') } } }
      : op.rawResponse
        ? { description: 'Success (raw bytes)', content: binaryContent(op.rawResponse) }
        : { description: 'Success (no content)' },
    default: { $ref: '#/components/responses/Error' },
  };
  if (op.auth !== 'public') operation.security = [{ bearer: [] }];
  return operation;
}

export function buildOpenApiDocument(operations: readonly ApiOperation[] = apiOperations): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const op of operations) {
    const item = (paths[op.path] ??= {});
    if (item[op.method]) throw new Error(`Duplicate OpenAPI operation ${op.method.toUpperCase()} ${op.path}`);
    item[op.method] = buildOperation(op);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'CASELIND API',
      version: apiVersion(),
      description: 'Generated from the zod contracts of @caselind/contracts. Every error uses the ApiError envelope.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { ApiError: toSchema(apiErrorSchema, 'output') },
      responses: {
        Error: {
          description: 'Error envelope (any non-2xx status)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      },
    },
    paths,
  };
}

let cached: OpenApiDocument | undefined;

/** The document is static for a given build: computed on first request, then served from memory. */
export function getOpenApiDocument(): OpenApiDocument {
  return (cached ??= buildOpenApiDocument());
}
