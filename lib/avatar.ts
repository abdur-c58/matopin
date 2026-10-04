/** Keys are stored on profiles and checked by the database, so they stay put when a colour changes. */
export const AVATAR_COLORS = {
  azure: { label: "Slate", bg: "#8792a8", fg: "#131313" },
  volt: { label: "Lime", bg: "#d7f25a", fg: "#131313" },
  coral: { label: "Coral", bg: "#ff7a6b", fg: "#131313" },
  amber: { label: "Amber", bg: "#ffb347", fg: "#131313" },
  teal: { label: "Teal", bg: "#2ec4b6", fg: "#131313" },
  pink: { label: "Pink", bg: "#f472b6", fg: "#131313" },
  violet: { label: "Violet", bg: "#a78bfa", fg: "#131313" },
} as const;

export type AvatarColor = keyof typeof AVATAR_COLORS;
export const DEFAULT_AVATAR_COLOR: AvatarColor = "azure";

export const isAvatarColor = (v: unknown): v is AvatarColor => typeof v === "string" && Object.hasOwn(AVATAR_COLORS, v);

/** A square region of an image, as fractions of its width (x, w) and height (y, h). */
export type AvatarCrop = { x: number; y: number; w: number; h: number };

export function cleanCrop(v: unknown): AvatarCrop | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return ok(c.x) && ok(c.y) && ok(c.w) && ok(c.h) && c.w > 0 && c.h > 0 ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
}

const SIZE = 256;
const MAX_UPLOAD = 15 * 1024 * 1024;
export const MAX_GIF = 1.5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const AVATAR_ACCEPT = TYPES.join(",");

/** A picked picture, loaded and ready to crop. `url` is an object URL; call `release` when done with it. */
export type AvatarSource = { file: File; url: string; width: number; height: number; gif: boolean; release: () => void };

export async function loadAvatarSource(file: File): Promise<AvatarSource> {
  if (!TYPES.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP, or GIF.");
  const gif = file.type === "image/gif";
  if (gif && file.size > MAX_GIF) throw new Error("GIFs can be up to 1.5 MB so they stay animated. Choose a smaller one.");
  if (file.size > MAX_UPLOAD) throw new Error("That image is over 15 MB. Choose a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { file, url, width: img.naturalWidth, height: img.naturalHeight, gif, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That image could not be read. Try a JPG, PNG, WebP, or GIF.");
  }
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * Stills are cut to the chosen square and shrunk so they are small enough to store on the profile.
 * GIFs would lose their animation on a canvas, so they are kept whole with the square saved beside them.
 */
export async function renderAvatar(source: AvatarSource, crop: AvatarCrop): Promise<{ avatar: string; avatarCrop: AvatarCrop | null }> {
  if (source.gif) return { avatar: await readDataUrl(source.file), avatarCrop: crop };
  const bitmap = await createImageBitmap(source.file);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.x * bitmap.width, crop.y * bitmap.height, crop.w * bitmap.width, crop.h * bitmap.height, 0, 0, SIZE, SIZE);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.85);
  return { avatar: webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85), avatarCrop: null };
}
