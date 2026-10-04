import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Google sign-in. The session lives in an encrypted cookie; `session.user.id` is `google:<account id>`, which
 * stays the same when the person changes their Google name, email, or photo, so it is what profiles are keyed on.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  trustHost: true,
  providers: [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })],
  session: { strategy: "jwt" },
  pages: { error: "/" },
  callbacks: {
    jwt({ token, account }) {
      if (account) token.subject = `${account.provider}:${account.providerAccountId}`;
      return token;
    },
    session({ session, token }) {
      if (typeof token.subject === "string") session.user.id = token.subject;
      return session;
    },
  },
});
