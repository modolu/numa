/**
 * Serves one exported HTML page from the static-hosting component's asset
 * store, so clean URLs like `/inbox` resolve to `inbox.html` on a hard load.
 * Assets are looked up through the component's own resolver; nothing here
 * accepts a path from the request.
 */
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";

export function servePage(assetPath: string) {
  return httpAction(async (ctx) => {
    const asset = await ctx.runQuery(components.staticHosting.lib.resolveAssetForHttp, {
      path: assetPath,
      spaFallback: true,
    });
    if (!asset?.storageUrl) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }
    const upstream = await fetch(asset.storageUrl);
    if (!upstream.ok || !upstream.body) {
      return new Response("Asset not available", { status: 502, headers: { "Content-Type": "text/plain" } });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // HTML must always be fresh so a new deploy is picked up immediately.
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
