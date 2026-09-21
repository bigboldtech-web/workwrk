// The ONE upload size limit (spec-docs-knowledge section 2, /files: "Max
// size 25 MB per file (the value of MAX_SIZE in api/upload/route.ts, rendered
// from a shared constant, never typed into copy)"). The route enforces it;
// every surface that prints it reads it from here.
//
// Pure module: no imports, safe on the client and the server.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
