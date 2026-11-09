import { redirect } from "react-router";
import type { Route } from "./+types/redeem.$code";

// Seat Code links were handed out as /redeem/<code> before the page moved to
// /claim/<code>. Keep those links working.
export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/claim/${encodeURIComponent(params.code)}`, 301);
}
