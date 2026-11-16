import { bearer, type TestContext } from './helpers.js';

export const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Announces and uploads in one go (lot 19m tests); returns the ready asset id. */
export async function uploadAsset(ctx: TestContext, token: string, purpose: string, mime: string, content: Buffer): Promise<string> {
  const ann = await ctx.http.post('/v1/media/uploads').set(bearer(token)).send({ purpose, mime, sizeBytes: content.length }).expect(201);
  await ctx.http.put(ann.body.uploadUrl).set(bearer(token)).set('X-Upload-Token', ann.body.uploadToken).set('Content-Type', 'application/octet-stream').send(content).expect(200);
  return ann.body.assetId as string;
}
