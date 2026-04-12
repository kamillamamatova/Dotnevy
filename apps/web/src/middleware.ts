import { withAuth } from 'next-auth/middleware'

// Protect all authenticated app routes.
// /dashboard/*  — main dashboard and repo list
// /repos/*      — connect flow and repo detail pages
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*', '/repos/:path*'],
}
