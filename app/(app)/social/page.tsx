"use client";
import { ProfilePage } from "@/components/profile-page";
import { useProfile } from "@/components/profiles";

export default function Social() {
  const { profile } = useProfile();
  return <ProfilePage key={profile} id={profile} guest={null} />;
}
