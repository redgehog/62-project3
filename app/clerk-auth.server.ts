import { getAuth } from "@clerk/react-router/server";
import { redirect } from "react-router";

type AuthArgs = {
  request: Request;
  context: unknown;
};

export async function requireSignedIn(args: AuthArgs) {
  const auth = await getAuth(args as never);
  if (!auth.userId) {
    const currentUrl = new URL(args.request.url);
    const returnTo = `${currentUrl.pathname}${currentUrl.search}`;
    throw redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  }
  return auth;
}
