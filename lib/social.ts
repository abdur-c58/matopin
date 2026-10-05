import type { AvatarColor, AvatarCrop } from "./avatar";

export type Visibility = "private" | "public" | "unlisted" | "collab";
export type DeckRole = "owner" | "collaborator" | "follower";
export type MemberRole = Exclude<DeckRole, "owner">;

export const isVisibility = (v: unknown): v is Visibility => v === "private" || v === "public" || v === "unlisted" || v === "collab";
export const isDeckRole = (v: unknown): v is DeckRole => v === "owner" || v === "collaborator" || v === "follower";

export const VISIBILITY_LABELS: Record<Visibility, string> = { private: "Private", public: "Public", unlisted: "Unlisted", collab: "Collab" };
export const ROLE_LABELS: Record<DeckRole, string> = { owner: "Owner", collaborator: "Collaborator", follower: "Follower" };

/** Who a deck belongs to and how this profile can use it, kept beside the browser copy of each deck. */
export type DeckMeta = { role: DeckRole; visibility: Visibility; ownerId: string; ownerName: string | null };

export type PersonRef = { id: string; name: string; avatar: string | null; avatarCrop: AvatarCrop | null; color: AvatarColor };

export type Person = PersonRef & {
  bio: string;
  followers: number;
  following: number;
  publicDecks: number;
  isFollowing: boolean;
  followsYou: boolean;
  joinedAt: string;
};

export type SharedDeck = {
  id: string;
  name: string;
  visibility: Visibility;
  cards: number;
  followers: number;
  role: DeckRole | null;
  owner: PersonRef;
  updatedAt: string;
};

export type DeckPreview = SharedDeck & { preview: { term: string | null; reading: string | null; meaning: string | null }[] };

export type Member = PersonRef & { role: MemberRole; joinedAt: string };
export type Sharing = { visibility: Visibility; inviteCode: string | null; members: Member[] };

export type ChatLink = { myStatus: "accepted" | "pending" | "declined"; theirStatus: "accepted" | "pending" | "declined" };
export type ProfileView = { person: Person; decks: SharedDeck[]; followers: Person[]; following: Person[]; chat: ChatLink | null };

/** What a visitor who isn't signed in sees of a profile. */
export type PublicProfile = {
  person: Omit<Person, "isFollowing" | "followsYou">;
  decks: { id: string; name: string; language: string | null; cards: number; followers: number; updatedAt: string }[];
};

export const inviteUrl = (code: string) => `${window.location.origin}/join/${code}`;
