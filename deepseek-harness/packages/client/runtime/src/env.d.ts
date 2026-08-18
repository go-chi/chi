/**
 * Bundler-replaced NODE_ENV: vite/tsdown substitute the literal, so browsers
 * never evaluate a bare `process`. tsconfig carries no node types on purpose.
 */
declare const process: { env: { NODE_ENV?: string } }
