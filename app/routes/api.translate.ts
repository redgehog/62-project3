import { data } from "react-router";
import type { Route } from "./+types/api.translate";

const GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const text = url.searchParams.get("q");
  const tl = url.searchParams.get("tl");
  const sl = url.searchParams.get("sl") ?? "auto";

  if (!text || !tl) {
    return data({ error: "Missing q or tl param" }, { status: 400 });
  }

  const params = new URLSearchParams({ client: "gtx", sl, tl, dt: "t", q: text });
  const res = await fetch(`${GOOGLE_TRANSLATE_URL}?${params.toString()}`);

  if (!res.ok) {
    return data({ error: `Upstream error: ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  const translated = json?.[0]?.[0]?.[0];

  if (typeof translated !== "string") {
    return data({ error: "Unexpected response" }, { status: 502 });
  }

  return { translated };
}
