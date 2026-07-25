import { runComplianceSync } from '../../modules/compliance/engine';
import type { BusinessProfile } from '../../modules/compliance/types';

export const config = { runtime: 'edge' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const NON_SLUG_CHARACTER_REGEX = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH_REGEX = /^-|-$/g;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function readRequiredString(payload: Record<string, unknown>, key: keyof BusinessProfile) {
  const value = payload[key];

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return value.trim();
}

function normalizeBusinessId(id: unknown, legalName: string) {
  if (typeof id === 'string' && id.trim()) {
    return id.trim();
  }

  const fallback = legalName
    .toLowerCase()
    .replace(NON_SLUG_CHARACTER_REGEX, '-')
    .replace(LEADING_TRAILING_DASH_REGEX, '');

  return fallback || crypto.randomUUID();
}

function toBusinessProfile(payload: Record<string, unknown>): BusinessProfile {
  const legalName = readRequiredString(payload, 'legalName');

  return {
    id: normalizeBusinessId(payload.id, legalName),
    legalName,
    ein: readRequiredString(payload, 'ein'),
    oldAddress: readRequiredString(payload, 'oldAddress'),
    newAddress: readRequiredString(payload, 'newAddress'),
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json(405, { error: 'Use POST' });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json(400, { error: 'JSON body must be an object' });
  }

  try {
    const result = await runComplianceSync(toBusinessProfile(payload as Record<string, unknown>));

    return json(200, {
      success: true,
      data: result,
    });
  } catch (error) {
    return json(400, {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to submit compliance sync',
    });
  }
}
