import { profilePreview } from "@/lib/link-preview";
import { CACHE, pageImage, profileImage } from "@/lib/og";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await profilePreview(id);
  return profile ? profileImage(profile) : pageImage("default", CACHE.missing);
}
