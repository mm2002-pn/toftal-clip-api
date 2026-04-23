/**
 * Lookup helper for DB-backed email & AI prompt templates.
 *
 * Behavior:
 *  - `renderEmailFromDB(name, vars)` → returns { subject, html } or null if
 *    the named template does not exist in the DB. Callers are expected to
 *    fall back to hardcoded templates in that case.
 *  - `renderAIPromptFromDB(name, vars)` → returns { systemPrompt, userPrompt,
 *    model, temperature, responseFormat } or null.
 *
 * In-memory cache (60s TTL) so we don't hit the DB on every send / AI call.
 * Cache is bypassed on admin update via `invalidateTemplateCache()`.
 */

import { prisma } from '../config/database';

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry<T> {
  value: T | null;
  expiresAt: number;
}

const emailCache = new Map<string, CacheEntry<any>>();
const aiCache = new Map<string, CacheEntry<any>>();

const isFresh = (entry?: CacheEntry<any>): boolean => {
  return !!entry && entry.expiresAt > Date.now();
};

/** Call from admin endpoints after an update to force a fresh lookup. */
export const invalidateTemplateCache = (kind: 'email' | 'ai' | 'all' = 'all'): void => {
  if (kind === 'email' || kind === 'all') emailCache.clear();
  if (kind === 'ai' || kind === 'all') aiCache.clear();
};

/**
 * Simple {{variable}} interpolation. Supports dotted paths like {{user.name}}.
 * Leaves `{{unknown}}` placeholders in place to make missing vars obvious in
 * the output — callers can grep for `{{` to detect issues.
 */
export const interpolate = (template: string, vars: Record<string, unknown>): string => {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split('.');
    let value: any = vars;
    for (const p of parts) {
      if (value == null || typeof value !== 'object') return `{{${path}}}`;
      value = value[p];
    }
    return value == null ? `{{${path}}}` : String(value);
  });
};

// ─── Email ────────────────────────────────────────────────────────────────

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
}

export const renderEmailFromDB = async (
  name: string,
  vars: Record<string, unknown>
): Promise<RenderedEmail | null> => {
  const cached = emailCache.get(name);
  let tmpl = isFresh(cached) ? cached!.value : null;

  if (!isFresh(cached)) {
    try {
      tmpl = await prisma.emailTemplate.findUnique({ where: { name } });
    } catch {
      tmpl = null;
    }
    emailCache.set(name, { value: tmpl, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  if (!tmpl) return null;

  return {
    subject: interpolate(tmpl.subject, vars),
    html: interpolate(tmpl.htmlBody, vars),
    text: tmpl.textBody ? interpolate(tmpl.textBody, vars) : undefined,
  };
};

// ─── AI prompts ───────────────────────────────────────────────────────────

export interface RenderedAIPrompt {
  systemPrompt: string | null;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number | null;
  responseFormat: string | null;
}

export const renderAIPromptFromDB = async (
  name: string,
  vars: Record<string, unknown>
): Promise<RenderedAIPrompt | null> => {
  const cached = aiCache.get(name);
  let tmpl = isFresh(cached) ? cached!.value : null;

  if (!isFresh(cached)) {
    try {
      tmpl = await prisma.aIPromptTemplate.findUnique({ where: { name } });
    } catch {
      tmpl = null;
    }
    aiCache.set(name, { value: tmpl, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  if (!tmpl) return null;

  return {
    systemPrompt: tmpl.systemPrompt ? interpolate(tmpl.systemPrompt, vars) : null,
    userPrompt: interpolate(tmpl.userPromptTemplate, vars),
    model: tmpl.model,
    temperature: tmpl.temperature,
    maxTokens: tmpl.maxTokens,
    responseFormat: tmpl.responseFormat,
  };
};
