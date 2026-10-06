import { auth } from "@/auth";
import LandingPage from "@/components/landing/landing-page";
import { APP_NAME } from "@/lib/brand";
import { HOME_DESCRIPTION, preview, TAGLINE } from "@/lib/link-preview";
import { signInError } from "@/lib/sign-in-errors";

export const metadata = preview({
  title: `${APP_NAME} · ${TAGLINE}`, description: HOME_DESCRIPTION, path: "/", image: "/og/home",
  alt: `${APP_NAME}: remember every word you learn, with Mandarin and Japanese flashcards`,
});

/** The installed app has no landing page: it goes straight to the app before anything is drawn. */
const STANDALONE_REDIRECT = `if(matchMedia("(display-mode: standalone)").matches||navigator.standalone)location.replace("/app"+location.search)`;

/** Public for everyone. A failed Google sign-in comes back here with `?error=`. */
export default async function Landing({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [session, query] = await Promise.all([auth(), searchParams]);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: STANDALONE_REDIRECT }} />
      <LandingPage signedIn={!!session?.user?.id} error={signInError(query.error)} />
    </>
  );
}
