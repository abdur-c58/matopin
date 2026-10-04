/**
 * Attribution the dictionary's licenses ask for, shown in the Sources & credits dialog. The Unicode notice must be
 * reproduced as is (https://www.unicode.org/license.txt).
 */

export const CEDICT_NOTE =
  "Word list and definitions from CC-CEDICT by MDBG and its contributors. Definitions are lightly reformatted " +
  "(measure words split out, cross-references given pinyin) and stay under CC BY-SA 4.0.";

export const TATOEBA_NOTE =
  "Example sentences, their pinyin and English translations from Tatoeba and its contributors, under CC BY 2.0 FR. " +
  "Each sentence links back to its page on Tatoeba.";

/** Stroke order isn't stored with the dictionary: the browser loads it per character from the jsDelivr CDN. */
export const STROKE_CREDITS = {
  library: { name: "Hanzi Writer", url: "https://hanziwriter.org", license: "MIT", licenseUrl: "https://github.com/chanind/hanzi-writer/blob/master/LICENSE" },
  data: {
    name: "Make Me a Hanzi stroke data", url: "https://github.com/skishore/makemeahanzi", license: "Arphic Public License",
    licenseUrl: "https://raw.githubusercontent.com/chanind/hanzi-writer-data/master/ARPHICPL.TXT",
  },
  note: "Stroke order animations and practice use Hanzi Writer by David Chanin. The stroke data comes from the Make Me a Hanzi project, " +
    "extracted from fonts by Arphic Technology, and is loaded from the free jsDelivr CDN (hanzi-writer-data).",
};

/** Pronunciation recordings, fetched on first play and kept in Supabase Storage. */
export const AUDIO_CREDITS = [
  {
    name: "audio-cmn", url: "https://github.com/hugolpz/audio-cmn", license: "CC BY-SA", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    covers: "Syllables and HSK words",
    note: "Syllables recorded by Chen Wang; HSK words and characters recorded by Yue Tan for Shtooka (cmn-caen-tan). Compiled by Hugo Lopez.",
  },
  {
    name: "Lingua Libre", url: "https://lingualibre.org", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    covers: "Words recorded by volunteers",
    note: "Word recordings by Lingua Libre volunteers, hosted on Wikimedia Commons. Hover a play button after playing to see who recorded it.",
  },
  {
    name: "Fish Audio", url: "https://fish.audio", license: "AI generated", licenseUrl: "https://fish.audio",
    covers: "Example sentences",
    note: "Example sentences are read slowly by a Fish Audio AI voice the first time anyone plays them, then kept for everyone.",
  },
  {
    name: "Tatoeba audio", url: "https://tatoeba.org", license: "CC BY / CC0 (per recording)", licenseUrl: "https://tatoeba.org/en/terms_of_use",
    covers: "Example sentences",
    note: "Sentence recordings by Tatoeba contributors, used when the AI voice isn't available. Only openly licensed recordings are used; other sentences are read word by word from the recordings above.",
  },
];

// Japanese -----------------------------------------------------------------------------------------------------------

export const JA_NOTES = {
  jmdict:
    "Words, readings and meanings from JMdict, the property of the Electronic Dictionary Research and Development Group, " +
    "used under its licence (CC BY-SA 4.0). Converted to JSON by jmdict-simplified.",
  kanjidic:
    "Kanji meanings, readings, stroke counts, grades and JLPT levels from KANJIDIC2, the property of the Electronic " +
    "Dictionary Research and Development Group, used under its licence (CC BY-SA 4.0).",
  tatoeba:
    "Example sentences, their furigana and English translations from Tatoeba and its contributors, under CC BY 2.0 FR. " +
    "Each sentence links back to its page on Tatoeba.",
  kanjivg:
    "Stroke order from KanjiVG by Ulrich Apel and contributors, under CC BY-SA 3.0, loaded per kanji from the free jsDelivr CDN.",
} as const;

export const JA_AUDIO_CREDITS = [
  {
    name: "Lingua Libre", url: "https://lingualibre.org", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    covers: "Japanese words recorded by volunteers",
    note: "Word recordings by Lingua Libre volunteers, hosted on Wikimedia Commons. Hover a play button after playing to see who recorded it.",
  },
  {
    name: "Fish Audio", url: "https://fish.audio", license: "AI generated", licenseUrl: "https://fish.audio",
    covers: "Example sentences, and words with no recording",
    note: "Read slowly by a Fish Audio AI voice the first time anyone plays them, then kept for everyone.",
  },
  {
    name: "Tatoeba audio", url: "https://tatoeba.org", license: "CC BY / CC0 (per recording)", licenseUrl: "https://tatoeba.org/en/terms_of_use",
    covers: "Example sentences",
    note: "Sentence recordings by Tatoeba contributors, used when the AI voice isn't available. Only openly licensed recordings are used.",
  },
];

/** Handwriting recognition for the drawing pad. HanziLookupJS loads from jsDelivr only when Google can't be reached. */
export const HANDWRITING_CREDITS = [
  {
    name: "Google handwriting input", url: "https://www.google.com/inputtools/", license: "Google Terms of Service", licenseUrl: "https://policies.google.com/terms",
    covers: "Drawing pad recognition",
    note: "What you draw is sent as stroke coordinates to Google's handwriting service, the one behind Google Input Tools, which suggests matching characters and words.",
  },
  {
    name: "HanziLookupJS", url: "https://github.com/gugray/HanziLookupJS", license: "GNU GPL / Arphic Public License", licenseUrl: "https://github.com/gugray/HanziLookupJS#license",
    covers: "Offline drawing pad recognition",
    note: "By Gabor L Ugray, after Jordan Kiang's HanziLookup (GPL). Its character data comes from Make Me a Hanzi under the Arphic Public License. Loaded unmodified from jsDelivr when Google's service is unavailable.",
  },
];

export const UNIHAN_NOTE = "Character readings, radicals, stroke counts and variants from the Unicode Unihan Database.";

export const UNICODE_LICENSE = `UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation (the "Data Files") or software and any associated documentation (the "Software") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall not be used in advertising or otherwise to promote the sale, use or other dealings in these Data Files or Software without prior written authorization of the copyright holder.`;
