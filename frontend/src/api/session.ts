export type TokenGetter = () => Promise<string | null>;
let current:
  | { getToken: TokenGetter; signal: AbortSignal; controller: AbortController }
  | undefined;
/** Tokens stay in Clerk memory; this adapter never persists them. */
export function configureApiSession(getToken: TokenGetter) {
  current?.controller.abort();
  const controller = new AbortController();
  const session = { getToken, signal: controller.signal, controller };
  current = session;
  return () => {
    controller.abort();
    if (current === session) current = undefined;
  };
}
export function apiSession() {
  return current;
}
