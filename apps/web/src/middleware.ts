import { withAuth } from 'next-auth/middleware'

// Protect all /dashboard routes
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: ['/dashboard/:path*'],
}
