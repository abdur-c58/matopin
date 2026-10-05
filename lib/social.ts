import type { AvatarColor, AvatarCrop } from "./avatar";
import type { Lang } from "./lang";

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
  /** Collaborators editing the deck. */
  members: number;
  /** People who saved a copy, once each. */
  saves: number;
  /** People whose copy's cards no longer match what they saved, once each. */
  remixes: number;
  /** The viewer's own copy of this deck, if they saved one and still have it. */
  copyId: string | null;
  role: DeckRole | null;
  owner: PersonRef;
  updatedAt: string;
};

export type DeckPreview = SharedDeck & { preview: { term: string | null; reading: string | null; meaning: string | null }[] };

export type Member = PersonRef & { role: MemberRole; joinedAt: string };
export type Sharing = { visibility: Visibility; inviteCode: string | null; saves: number; remixes: number; members: Member[] };

export type ChatLink = { myStatus: "accepted" | "pending" | "declined"; theirStatus: "accepted" | "pending" | "declined" };
/** How many people imported (saved a copy of) a person's decks, and how many remixed them, by deck language. */
export type Reach = { imports: Record<Lang, number>; remixes: Record<Lang, number> };

export type ProfileView = { person: Person & { reach?: Reach }; decks: SharedDeck[]; followers: Person[]; following: Person[]; chat: ChatLink | null };

/** What a visitor who isn't signed in sees of a profile. */
export type PublicProfile = {
  person: Omit<Person, "isFollowing" | "followsYou"> & { reach?: Reach };
  decks: { id: string; name: string; language: string | null; cards: number; saves: number; remixes: number; updatedAt: string }[];
};

/** "40 cards · 12 imports · 3 remixes", leaving out remixes until there is one. */
export function deckStats(deck: { cards: number; saves: number; remixes: number }) {
  const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  return [count(deck.cards, "card"), count(deck.saves, "import"), ...(deck.remixes ? [count(deck.remixes, "remix", "remixes")] : [])].join(" · ");
}

export const inviteUrl = (code: string) => `${window.location.origin}/join/${code}`;
