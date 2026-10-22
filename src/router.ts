export type Route =
  | "home"
  | "characters"
  | "character-new"
  | "character-edit"
  | "new"
  | "draw"
  | "work-missing"
  | "data"
  | "not-found";
export function resolveRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  if (path === "/") return "home";
  if (path === "/characters") return "characters";
  if (path === "/characters/new") return "character-new";
  if (/^\/characters\/[^/]+$/.test(path)) return "character-edit";
  if (path === "/new") return "new";
  if (path === "/draw/new") return "draw";
  if (/^\/(works|draw)\/[^/]+$/.test(path)) return "work-missing";
  if (path === "/settings/data") return "data";
  return "not-found";
}

export function characterIdFromHash(hash: string): string | undefined {
  const match = /^#?\/characters\/([^/]+)$/.exec(hash);
  if (!match || match[1] === "new") return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
