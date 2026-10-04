import Image from "next/image";
import { AVATAR_COLORS, type AvatarColor, type AvatarCrop } from "@/lib/avatar";

/** The profile picture, or the name's first letter on the profile's colour. A crop shows just that square of the picture. */
export function Avatar({ name, avatar, color, crop, className = "size-11 text-base" }: { name: string; avatar: string | null; color: AvatarColor; crop?: AvatarCrop | null; className?: string }) {
  if (avatar && crop) {
    return (
      <span className={`relative block shrink-0 overflow-hidden rounded-full ${className}`}>
        <Image
          src={avatar} alt="" width={256} height={256} unoptimized referrerPolicy="no-referrer" className="absolute max-w-none"
          style={{ width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` }}
        />
      </span>
    );
  }
  if (avatar) return <Image src={avatar} alt="" width={256} height={256} unoptimized referrerPolicy="no-referrer" className={`shrink-0 rounded-full object-cover ${className}`} />;
  const c = AVATAR_COLORS[color] ?? AVATAR_COLORS.azure;
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-bold uppercase select-none ${className}`} style={{ backgroundColor: c.bg, color: c.fg }} aria-hidden>
      {[...name.trim()][0] ?? "?"}
    </span>
  );
}

/** An avatar for anyone with a picture, colour, and optional crop. */
export function PersonAvatar({ person, className }: { person: { name: string; avatar: string | null; avatarCrop?: AvatarCrop | null; color: AvatarColor }; className?: string }) {
  return <Avatar name={person.name} avatar={person.avatar} color={person.color} crop={person.avatarCrop} className={className} />;
}
