import { NextResponse, type NextRequest } from "next/server";
import { SECTIONS } from "@/lib/features";

const NOINDEX_HEADER = "noindex, nofollow";

function redirectWithNoindex(request: NextRequest, target: string): NextResponse {
  const response = NextResponse.redirect(new URL(target, request.url), 307);
  response.headers.set("X-Robots-Tag", NOINDEX_HEADER);
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!SECTIONS.growth && (pathname === "/memory/growth" || pathname.startsWith("/memory/growth/"))) {
    return redirectWithNoindex(request, "/memory");
  }

  if (!SECTIONS.people && (pathname === "/memory/people" || pathname.startsWith("/memory/people/"))) {
    return redirectWithNoindex(request, "/memory");
  }

  if (!SECTIONS.health && (pathname === "/health" || pathname.startsWith("/health/"))) {
    return redirectWithNoindex(request, "/");
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/memory/growth",
    "/memory/growth/:path*",
    "/memory/people",
    "/memory/people/:path*",
    "/health",
    "/health/:path*",
  ],
};
