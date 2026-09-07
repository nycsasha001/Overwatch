import { NextResponse, type NextRequest } from "next/server";
import {
  PORTFOLIO_COOKIE,
  SESSION_COOKIE,
  authState,
  isPortfolioAuthPath,
  isPortfolioPath,
  isPublicPath,
  portfolioLockState,
  verifySession,
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
    // Signed in to the app. The Portfolio page may still want a second password of its own.
    return portfolioGate(req, pathname, isApi);
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
 * The second gate, in front of the Portfolio page only.
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
