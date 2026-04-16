import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import { prisma } from '@dotenvy/db'

// ─── Auth architecture notes ──────────────────────────────────────────────────
//
// USER AUTH (this file)
// Uses GitHub OAuth (not GitHub App) to authenticate individual users.
// Scopes requested: default only (read:user, user:email). No repo access.
// We store the minimum: githubId, githubLogin, email, and avatar for display.
//
// GITHUB APP / REPO INSTALLATION (separate concern)
// The GitHubInstallation model and /api/github/webhook route handle the
// GitHub App installation flow that grants Dotenvy access to repos.
// A user can be signed in (user auth) independently of whether they or their
// org has installed the GitHub App. The installationId on Repo ties the two
// together: the user's identity is resolved from their session, while repo
// access is delegated through the App installation.
//
// This separation means:
//   - Users sign in once via OAuth (this file)
//   - Orgs/users install the GitHub App separately (app installation flow)
//   - The app never needs broad OAuth scopes like `repo`
// ─────────────────────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      // Uses OAuth credentials from a GitHub OAuth App (or the "User authorization
      // callback URL" of a GitHub App). Do NOT request `repo` scope here — repo
      // access is granted via GitHub App installation, not OAuth scopes.
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
      // No extra authorization params — default scopes (read:user, user:email) only.
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!profile || !account) return false

      const githubProfile = profile as { id: number; login: string; avatar_url: string }

      // Upsert on every sign-in so profile info (login rename, new email) stays current.
      // Only the minimum identity fields are persisted — no OAuth tokens stored here.
      await prisma.user.upsert({
        where: { githubId: githubProfile.id },
        create: {
          githubId: githubProfile.id,
          githubLogin: githubProfile.login,
          email: user.email,
          name: user.name,
          image: githubProfile.avatar_url,
        },
        update: {
          githubLogin: githubProfile.login,
          email: user.email,
          name: user.name,
          image: githubProfile.avatar_url,
        },
      })

      return true
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      if (session.user && token.githubLogin) {
        session.user.githubLogin = token.githubLogin as string
      }
      return session
    },

    async jwt({ token, profile }) {
      if (profile) {
        // profile is only present on the initial sign-in callback.
        // Persist the DB user ID and GitHub login into the JWT so they survive
        // across requests without a DB round-trip on every session read.
        const githubProfile = profile as { id: number; login: string }
        const dbUser = await prisma.user.findUnique({ where: { githubId: githubProfile.id } })
        if (dbUser) {
          token.sub = dbUser.id
          token.githubLogin = dbUser.githubLogin ?? githubProfile.login
        }
      }
      return token
    },
  },

  pages: {
    signIn: '/login',
  },
}

// ─── next-auth type augmentations ─────────────────────────────────────────────

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      githubLogin: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    githubLogin?: string
  }
}
