import { NextResponse, type NextRequest } from "next/server";
import {
  PORTFOLIO_COOKIE,
  SESSION_COOKIE,
  USER_COOKIE,
  authState,
  isAccountPath,
  isPortfolioAuthPath,
  isPortfolioPath,
  isPublicPath,
  portfolioLockState,
  userAuthState,
  verifySession,
  verifyUserSession,
} from "@/lib/auth";

/**
 * One gate in front of everything.
 *
 * Middleware is the only place in Next.js that sees *every* request — pages, route handlers,
 * server actions, images — before any of them run. Checking in a layout would leave the API wide
 * open, and checking in each route handler would mean the next one anybody adds is unprotected by
 * default. Here, a new endpoint is behind the password the moment it exists.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const state = authState(process.env.APP_PASSWORD, process.env.NODE_ENV === "production");

  // A production build with no password configured refuses to serve anything rather than serving
  // everything. Silently running wide open is the one outcome worth breaking the app to avoid.
  if (state.mode === "misconfigured") {
    return new NextResponse(
      isApi
        ? JSON.stringify({ error: "APP_PASSWORD is not set on the server." })
        : "APP_PASSWORD is not set on the server. Set it and restart.",
      {
        status: 503,
        headers: { "content-type": isApi ? "application/json" : "text/plain; charset=utf-8" },
      }
    );
  }

  if (state.mode === "open") return NextResponse.next();
  if (isPublicPath(pathname)) return NextResponse.next();

  if (await verifySession(state.secret, req.cookies.get(SESSION_COOKIE)?.value)) {
    // Past the shared password. Now: which account?
    return accountGate(req, pathname, search, isApi);
  }

  // An unauthenticated API call gets a status, not a login page: a fetch cannot use HTML, and
  // redirecting one produces a confusing 200 full of markup instead of an honest 401.
  if (isApi) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Remembered so signing in lands where you were going, rather than dumping you on the dashboard.
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

/**
 * The account gate: past the shared password, but is anybody signed in?
 *
 * What this can and cannot do is worth being precise about. Middleware runs on the Edge runtime,
 * where there is no SQLite, so this can verify that a token is authentic and unexpired but *not*
 * that the account it names still exists. That is deliberate and sufficient here, because this only
 * decides where to send the browser. Every route handler that touches data calls requireUser, which
 * resolves the id against the database and fails closed if the account is gone. Nothing is
 * authorised on the strength of this check alone.
 */
async function accountGate(req: NextRequest, pathname: string, search: string, isApi: boolean) {
  const users = userAuthState(process.env.AUTH_SECRET, process.env.NODE_ENV === "production");

  // No signing key in production means forged sessions would be indistinguishable from real ones.
  // Refuse to serve rather than accept them, exactly as the shared password does.
  if (users.mode === "misconfigured") {
    return new NextResponse(
      isApi
        ? JSON.stringify({ error: "AUTH_SECRET is not set on the server." })
        : "AUTH_SECRET is not set on the server. Set it and restart.",
      {
        status: 503,
        headers: { "content-type": isApi ? "application/json" : "text/plain; charset=utf-8" },
      }
    );
  }

  // Development with no AUTH_SECRET behaves as it always did: one shared journal, no sign-in. The
  // alternative is demanding an account before a local run will start, which is the same nuisance
  // the shared password avoids by staying open in development.
  if (users.mode === "open") return portfolioGate(req, pathname, isApi);

  // The sign-in screen and the endpoints it posts to, which must stay reachable while signed out.
  if (isAccountPath(pathname)) return NextResponse.next();

  const userId = await verifyUserSession(users.secret, req.cookies.get(USER_COOKIE)?.value);
  if (!userId) {
    // Same reasoning as the shared gate: a fetch cannot render a sign-in page, so it gets a status.
    if (isApi) return NextResponse.json({ error: "No account signed in" }, { status: 401 });

    const account = req.nextUrl.clone();
    account.pathname = "/account";
    account.search = "";
    if (pathname !== "/") account.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(account);
  }

  return portfolioGate(req, pathname, isApi);
}

/**
 * The third gate, in front of the Portfolio page only.
 *
 * Enforced here rather than in the page component for the same reason as the main gate: a check in
 * the UI leaves `/api/portfolio` answerable to anyone who types the URL, which would make the lock
 * decorative. Everything under `/api/portfolio` is covered, so a route added later is locked the
 * moment it exists.
 */
async function portfolioGate(req: NextRequest, pathname: string, isApi: boolean) {
  const lock = portfolioLockState(process.env.PORTFOLIO_PASSWORD);
  if (lock.mode === "off") return NextResponse.next();
  if (!isPortfolioPath(pathname)) return NextResponse.next();
  if (isPortfolioAuthPath(pathname)) return NextResponse.next();

  if (await verifySession(lock.secret, req.cookies.get(PORTFOLIO_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // 423 Locked rather than 401: the caller *is* authenticated, so a 401 would send the client off
  // to the main login screen and strand them in a loop it can never satisfy.
  if (isApi) {
    return NextResponse.json({ error: "The portfolio is locked", locked: true }, { status: 423 });
  }
  return NextResponse.next();
}

export const config = {
  /**
   * Everything except the build output and static files.
   *
   * Deliberately not a list of protected paths: an allowlist of what to guard is a list somebody
   * forgets to add to. This guards everything and names the handful of exceptions instead.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
