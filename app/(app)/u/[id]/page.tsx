import type { Metadata } from "next";
import { auth } from "@/auth";
import { ProfilePage } from "@/components/profile-page";
import { APP_NAME } from "@/lib/brand";
import { pagePreview, plural, preview, profilePreview, publicProfile } from "@/lib/link-preview";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const path = `/u/${id}`;
  const profile = await profilePreview(id);
  if (!profile) return pagePreview("social", path);
  const decks = plural(profile.publicDecks, "public deck");
  return preview({
    title: `${profile.name} · ${APP_NAME}`,
    description: `${profile.name} is learning on ${APP_NAME}. ${decks} to follow and study.`,
    path, image: `/og/u/${id}`, data: profile,
    alt: `${profile.name}'s profile on ${APP_NAME}, with ${decks}`,
  });
}

export default async function Profile({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const guest = session?.user?.id ? null : await publicProfile(id);
  return <ProfilePage key={id} id={id} guest={guest} />;
}
