/// <reference types="vite/client" />
/**
 * Module map for convex-test. The Convex bundler skips files with more than
 * one dot in the name, so this file never ships to a deployment.
 */
export const modules = import.meta.glob("./**/*.*s");
