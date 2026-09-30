// Stands in for src/lib/auth.ts inside the offline scripts (the parity job):
// they never read a session, and NextAuth's providers are CommonJS default
// exports Node's ESM loader cannot call. A session read through this stub is
// always signed out.
export const authOptions = {};
