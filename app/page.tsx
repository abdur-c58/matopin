import { auth } from "@/auth";
import LandingPage from "@/components/landing/landing-page";
import { signInError } from "@/lib/sign-in-errors";

/** Public for everyone. A failed Google sign-in comes back here with `?error=`. */
export default async function Landing({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [session, query] = await Promise.all([auth(), searchParams]);
  return <LandingPage signedIn={!!session?.user?.id} error={signInError(query.error)} />;
}
