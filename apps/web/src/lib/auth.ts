import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import { prisma } from '@pullenv/db'

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!profile || !account) return false

      const githubProfile = profile as { id: number; login: string; avatar_url: string }

      // Upsert the user on every sign-in so profile info stays current
      await prisma.user.upsert({
        where: { githubId: githubProfile.id },
        create: {
          githubId: githubProfile.id,
          githubLogin: githubProfile.login,
          email: user.email,
          avatarUrl: githubProfile.avatar_url,
        },
        update: {
          githubLogin: githubProfile.login,
          email: user.email,
          avatarUrl: githubProfile.avatar_url,
        },
      })

      return true
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },

    async jwt({ token, profile }) {
      if (profile) {
        const githubProfile = profile as { id: number }
        const dbUser = await prisma.user.findUnique({ where: { githubId: githubProfile.id } })
        if (dbUser) token.sub = dbUser.id
      }
      return token
    },
  },

  pages: {
    signIn: '/login',
  },
}

// Extend the next-auth Session type
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
