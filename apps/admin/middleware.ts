import { NextResponse, type NextRequest } from 'next/server';

/**
 * A light redirect only — the real authorization is server-side in the API
 * (Task 04). The refresh cookie is httpOnly and path-scoped to the API origin,
 * so the true session guard is the client bootstrap in Providers (silent
 * refresh → redirect to /login on failure). Here we only route the bare root.
 */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
