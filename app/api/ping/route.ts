/** Lets the app check whether the server is reachable again after a connection drop. */
export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
