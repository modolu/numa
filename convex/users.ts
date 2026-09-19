/**
 * Users. Identity resolution lives in convex/lib/identity.ts (temporary
 * demo identity until real auth lands).
 */
import { query } from "./_generated/server";
import { DEMO_IDENTITY_SUBJECT, getCurrentUser } from "./lib/identity";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      displayName: user.displayName ?? null,
      timezone: user.timezone,
      isDemoIdentity: user.identitySubject === DEMO_IDENTITY_SUBJECT,
    };
  },
});
