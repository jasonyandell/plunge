/** Small shared pieces for API handlers. */
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
/** The JSON object body, or a SyntaxError naming why not; never more than `limit` bytes. */
export async function readJson(request: Request, limit: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); const decoder = new TextDecoder(); let text = '', size = 0;
  if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new SyntaxError('Request is too large.'); } text += decoder.decode(part.value, { stream: true }); }
  const data: unknown = JSON.parse(text + decoder.decode() || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('Invalid request.');
  return data as Record<string, unknown>;
}
