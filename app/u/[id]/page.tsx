"use client";
import { useParams } from "next/navigation";
import { ProfilePage } from "@/components/profile-page";

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  return <ProfilePage key={id} id={id} />;
}
