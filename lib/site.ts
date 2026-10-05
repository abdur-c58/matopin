/**
 * The site's public address, for absolute links in previews. SITE_URL wins when set; on Vercel production uses the
 * project's production domain and previews their own deployment URL.
 */
function resolveSiteUrl(): URL {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return new URL(explicit);
  const host = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
  return new URL(host ? `https://${host}` : `http://localhost:${process.env.PORT ?? 3000}`);
}

export const SITE_URL = resolveSiteUrl();
