"use client";
import { useState } from "react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { Check, ChevronRight, Flame } from "lucide-react";
import { toast } from "sonner";
import { dayKey } from "@/lib/srs";
import { entriesOf, groupByDay, streaks } from "@/lib/stats";
import { FLUENCY_LABELS, FLUENCY_LEVELS, type Fluency } from "@/lib/cards";
import { applyTheme, THEME_LABELS, THEME_MODES, type ThemeMode } from "@/lib/theme";
import { Avatar } from "./avatar";
import { ProgressBar } from "./charts";
import { RailTip } from "./rail-tip";
import { ProfileDialog, useProfile } from "./profiles";
import { useGoal, useProfileData } from "./use-stats";

const item = "flex h-10 cursor-pointer items-center gap-3 rounded-concentric px-3 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-raised";

function Today() {
  const data = useProfileData();
  const [goal] = useGoal();
  const entries = data ? entriesOf(data.decks) : [];
  const reviews = data ? groupByDay(entries).get(dayKey(data.now))?.reviews ?? 0 : 0;
  const streak = data ? streaks(entries, data.now).current : 0;
  return (
    <div className="grid grid-cols-2 gap-2 px-1 pb-2">
      <div className="rounded-md bg-porcelain p-3">
        <p className="text-xs text-muted">Today</p>
        <p className="mt-0.5 text-sm"><span className="text-lg font-bold tabular-nums">{reviews}</span><span className="text-muted"> / {goal}</span></p>
        <ProgressBar value={reviews / goal} className="mt-2 h-1.5" />
      </div>
      <div className="rounded-md bg-porcelain p-3">
        <p className="text-xs text-muted">Streak</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-lg font-bold tabular-nums">
          <Flame className={`size-4 ${streak ? "text-volt-ink" : "text-muted"}`} />{streak}
          <span className="text-sm font-normal text-muted">day{streak === 1 ? "" : "s"}</span>
        </p>
      </div>
    </div>
  );
}

/** The sidebar avatar: who is signed in, today's progress, and quick profile actions. */
export function AccountMenu() {
  const { profile, name, email, avatar, avatarCrop, color, fluency, setFluency, leave, prefs, setPrefs } = useProfile();
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  function changeTheme(theme: ThemeMode) {
    applyTheme(theme);
    void setPrefs({ theme }).catch(() => toast.error("Couldn't save the appearance."));
  }

  async function changeFluency(next: Fluency) {
    if (next === fluency) return;
    try {
      await setFluency(next);
      toast.success(`Fluency set to ${FLUENCY_LABELS[next]}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the fluency level.");
    }
  }

  async function logout() {
    setLeaving(true);
    await leave();
  }

  return (
    <>
      <DropdownMenu.Root>
        <RailTip label={name} zh="账户" pinyin="zhànghù">
          <DropdownMenu.Trigger
            className="shrink-0 rounded-full ring-2 ring-transparent transition outline-none hover:ring-volt-edge/50 hover:brightness-110 focus-visible:ring-volt-edge active:scale-90 data-[state=open]:ring-volt-edge"
            aria-label={`Account menu for ${name}`}
          >
            <Avatar name={name} avatar={avatar} crop={avatarCrop} color={color} />
          </DropdownMenu.Trigger>
        </RailTip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right" align="end" sideOffset={26} collisionPadding={12}
            className="popup w-72 p-2 [--pad:--spacing(2)]"
            onCloseAutoFocus={(e) => { if (editing) e.preventDefault(); }}
          >
            <div className="flex items-center gap-3 p-2 pb-3">
              <Avatar name={name} avatar={avatar} crop={avatarCrop} color={color} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                {email && <p className="truncate text-xs text-muted">{email}</p>}
              </div>
            </div>
            <Today />

            <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-line" />

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={`${item} data-[state=open]:bg-raised`}>
                <span className="flex-1">Fluency</span>
                <span className="truncate text-xs text-muted">{FLUENCY_LABELS[fluency]}</span>
                <ChevronRight className="size-4 text-muted" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={10} collisionPadding={12} className="popup w-60 p-2 [--pad:--spacing(2)]">
                  <DropdownMenu.Label className="px-3 pt-1 pb-2 text-xs text-muted">Example sentences match this level.</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup value={fluency} onValueChange={(v) => void changeFluency(v as Fluency)}>
                    {FLUENCY_LEVELS.map((level) => (
                      <DropdownMenu.RadioItem key={level} value={level} className={item}>
                        <span className="flex-1">{FLUENCY_LABELS[level]}</span>
                        <DropdownMenu.ItemIndicator><Check className="size-4 text-volt-ink" /></DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={`${item} data-[state=open]:bg-raised`}>
                <span className="flex-1">Appearance</span>
                <span className="truncate text-xs text-muted">{THEME_LABELS[prefs.theme]}</span>
                <ChevronRight className="size-4 text-muted" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={10} collisionPadding={12} className="popup w-48 p-2 [--pad:--spacing(2)]">
                  <DropdownMenu.RadioGroup value={prefs.theme} onValueChange={(v) => changeTheme(v as ThemeMode)}>
                    {THEME_MODES.map((mode) => (
                      <DropdownMenu.RadioItem key={mode} value={mode} className={item} onSelect={(e) => e.preventDefault()}>
                        <span className="flex-1">{THEME_LABELS[mode]}</span>
                        <DropdownMenu.ItemIndicator><Check className="size-4 text-volt-ink" /></DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

            <DropdownMenu.Item className={item} asChild>
              <Link href={`/u/${profile}`}>Your profile</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={() => setEditing(true)}>
              Edit profile
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-line" />

            <DropdownMenu.Item className={`${item} text-tone-1 data-[highlighted]:bg-tone-1/10`} disabled={leaving} onSelect={() => void logout()}>
              Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </>
  );
}
