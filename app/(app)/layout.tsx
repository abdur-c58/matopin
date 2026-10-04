import { AppShell } from "@/components/app-shell";
import { ProfileProvider } from "@/components/profiles";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ProfileProvider><AppShell>{children}</AppShell></ProfileProvider>;
}
