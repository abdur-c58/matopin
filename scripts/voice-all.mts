/**
 * Re-voices every card in every deck with Fish Audio: each term, and each line of each example in the deck language's voices,
 * replacing the stored clips in the card-audio folder of the R2 bucket. Needs supabase/005_card_audio.sql.
 *
 *   npm run voice:all                       regenerate everything
 *   npm run voice:all -- --missing          only lines that have no clip yet
 *   npm run voice:all -- --deck=hsk         only decks whose name or id contains "hsk"
 *   npm run voice:all -- --dry-run          count the lines without calling Fish Audio
 *   npm run voice:all -- --concurrency=4    clips generated at once (default 2)
 */
import { CARD_AUDIO_FOLDER, cardClipPath, voiceCardLine } from "../lib/card-audio";
import { objectExists } from "../lib/storage";
import { detectLanguage } from "../lib/lang";
import { rpc } from "../lib/supabase";
import { type Card, normalizeCard, type Spoken, spokenTexts } from "../lib/cards";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const missingOnly = flag("missing");
const dryRun = flag("dry-run");
const deckFilter = option("deck")?.toLowerCase();
const concurrency = Math.max(1, Math.min(8, Number(option("concurrency")) || 2));

type DeckRow = { id: string; name: string; cards: Partial<Card>[] };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Exit code: 0 when everything was voiced. Returning rather than calling process.exit lets open sockets close first. */
async function main(): Promise<number> {
  let decks: DeckRow[];
  try {
    decks = await rpc<DeckRow[]>("matopin_all_deck_cards", {}, { admin: true });
  } catch (e) {
    console.error(/missing the app tables/i.test(message(e)) ? "Run supabase/005_card_audio.sql in the Supabase SQL editor first." : message(e));
    return 1;
  }
  if (deckFilter) decks = decks.filter((d) => d.id.toLowerCase().includes(deckFilter) || d.name.toLowerCase().includes(deckFilter));

  const lines = new Map<string, Spoken>();
  let cardCount = 0;
  for (const deck of decks) {
    const cards = (Array.isArray(deck.cards) ? deck.cards : []).map((raw) => normalizeCard(raw));
    const lang = detectLanguage(cards) ?? "zh";
    for (const card of cards) {
      if (!card.term.trim() && !card.reading.trim()) continue;
      cardCount++;
      for (const line of spokenTexts(card, true, lang)) lines.set(cardClipPath(line.text, line), line);
    }
  }
  console.log(`${decks.length} deck${decks.length === 1 ? "" : "s"}, ${cardCount} cards, ${lines.size} unique lines to voice.`);
  if (dryRun || !lines.size) return 0;

  let todo = [...lines.entries()];
  if (missingOnly) {
    const present = await Promise.all(todo.map(([path]) => objectExists(CARD_AUDIO_FOLDER, path).catch(() => false)));
    todo = todo.filter((_, i) => !present[i]);
    console.log(`${lines.size - todo.length} already stored, ${todo.length} missing.`);
  }

  let done = 0;
  const failed: { text: string; error: string }[] = [];
  const voice = async (line: Spoken) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await voiceCardLine(line.text, line);
        return;
      } catch (e) {
        if (/storage isn't set up/i.test(message(e))) throw e;
        if (attempt >= 3) { failed.push({ text: line.text, error: message(e) }); return; }
        await wait(1500 * attempt);
      }
    }
  };

  const queue = todo.map(([, line]) => line);
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let line = queue.shift(); line; line = queue.shift()) {
        await voice(line);
        done++;
        const label = `${line.lang}${line.voice}: ${line.text}`;
        process.stdout.write(`\r${done}/${todo.length}  ${label.slice(0, 40).padEnd(40)}`);
      }
    }));
  } catch (e) {
    console.error(`\n${message(e)}`);
    return 1;
  }

  console.log(`\nVoiced ${done - failed.length} of ${todo.length} lines.`);
  if (!failed.length) return 0;
  console.log(`${failed.length} failed:`);
  for (const f of failed.slice(0, 20)) console.log(`  ${f.text.slice(0, 40)}  ${f.error}`);
  return 1;
}

process.exitCode = await main();
