import { redirect } from "react-router";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Redirecting — Boba House" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect") || "/portal";
  return redirect(`/sign-in?redirect_url=${encodeURIComponent(redirectTo)}`);
}

export default function Login() {
  return null;
}
