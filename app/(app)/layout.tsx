import { AppFeel } from "@/components/app-feel";
import { AppShell } from "@/components/app-shell";
import { AppSplash } from "@/components/offline";
import { ProfileProvider } from "@/components/profiles";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppSplash />
      <AppFeel />
      <ProfileProvider><AppShell>{children}</AppShell></ProfileProvider>
    </>
  );
}
