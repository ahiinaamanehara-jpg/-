export type Route =
  | "home"
  | "characters"
  | "character-new"
  | "character-missing"
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
  if (/^\/characters\/[^/]+$/.test(path)) return "character-missing";
  if (path === "/new") return "new";
  if (path === "/draw/new") return "draw";
  if (/^\/(works|draw)\/[^/]+$/.test(path)) return "work-missing";
  if (path === "/settings/data") return "data";
  return "not-found";
}
