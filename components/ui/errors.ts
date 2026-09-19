import { ConvexError } from "convex/values";

/** User-facing message for a failed mutation. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  if (error instanceof Error) {
    return "That didn't go through. Please try again.";
  }
  return "Something went wrong.";
}
