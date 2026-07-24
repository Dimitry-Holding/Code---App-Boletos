export const runtime = "nodejs";

/**
 * Endpoint público de saúde/monitoramento.
 * Mostra qual commit está no ar (útil para confirmar deploys).
 * GET /api/health → { ok, commit, ambiente }
 */
export async function GET() {
  return Response.json({
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    ambiente: process.env.VERCEL_ENV ?? "local",
  });
}
