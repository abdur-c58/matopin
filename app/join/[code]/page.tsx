"use client";
import { useParams } from "next/navigation";
import { JoinPage } from "@/components/join-page";

export default function Join() {
  const { code } = useParams<{ code: string }>();
  return <JoinPage key={code} code={code} />;
}
