const request = require("request");
const fs = require("fs");
const HTMLParser = require("node-html-parser");
const dictionary_file = "./dictionary.txt";
const set = new Set();

generateDictionary3();

function generateDictionary2() {
  const dic_file = fs.readFileSync(dictionary_file).toString();
  const arr = dic_file.split("\n").map(parseLine);

  fs.writeFileSync("dic2.json", JSON.stringify(arr, null, 2));
}

function generateDictionary3() {
  const dic_file = fs.readFileSync(dictionary_file).toString();
  const arr = dic_file.split("\n").map(parseLine);
  arr
    .filter((entry) => entry.flags !== undefined)
    .forEach((entry) => parseTags(entry));

  fs.writeFileSync("dic3.json", JSON.stringify(arr, null, 2));
}

// index of needle in haystack, or haystack's length when needle is not found
function indexOfOrLength(haystack, needle, start) {
  const index = haystack.indexOf(needle, start);
  return index < 0 ? haystack.length : index;
}

// index of first non space character
function wordStart(line) {
  for (let i = 0; i < line.length; i++) {
    if (line.charAt(i) !== " ") return i;
  }

  return -1;
}

// search for word end index after offset
function wordEndFromIndex(line, offset) {
  return Math.min(
    // dictionary tags delimiters
    ...["[", "(", "{", "<"]
      // do not include the space between the word end and the delimiter
      .map((ch) => line.indexOf(ch, offset) - 1)
      // add the double space delimiter to the equation
      .concat(line.indexOf("  ", offset), line.length)
      // filter only the found indexes
      .filter((i) => i >= offset)
  );
}

// index of the word/meaning delimiter
function wordMeaningSplitIndex(line, start, isObsolete) {
  // obsolete words are separated by '>', other entries use two spaces
  return indexOfOrLength(line, isObsolete ? ">" : "  ", start);
}

// parse an entry of the dictionary
function parseLine(line) {
  const parsedObj = {};

  // extract data from the line
  const [start, end, isObsolete, isLent, word] = (() => {
    let start = wordStart(line);
    const isObsolete = line[start] === "[";
    const isLent = line[start] === "«";
    start += isObsolete ? 1 : 0;
    const end = wordEndFromIndex(line, start);

    return [start, end, isObsolete, isLent, line.substring(start, end)];
  })();

  parsedObj.word = word;
  // if false exclude from the output json
  parsedObj.isObsolete = isObsolete || undefined;
  parsedObj.isLent = isLent || undefined;

  // 2 the the delimiter length. '  ', '> '
  const meaningStart = wordMeaningSplitIndex(line, start, isObsolete) + 2;

  // some words do not have meaning
  const hasMeaning = meaningStart < line.length;
  const hasFlags = meaningStart - end > 3;

  if (hasFlags) {
    // flags are between the word and its meaning
    parsedObj.flags = line.substring(
      end + 1,
      meaningStart - 2 - (isObsolete ? 1 : 0)
    );
  }

  if (hasMeaning) {
    if (isObsolete) {
      // the "meaning" of obsolete words is the new word
      const meaningEnd = indexOfOrLength(line, "]", meaningStart);
      parsedObj.newWord = line.substring(meaningStart, meaningEnd);

      // some entries have more flags after the closing delimiter
      if (line.length - meaningEnd > 1) {
        parsedObj.flags += line.substring(meaningEnd + 1, line.length);
      }
    } else {
      parsedObj.meaning = line.substring(meaningStart, line.length);
    }
  }

  return parsedObj;
}

// parse the entry tags to something more friendly
function parseTags(entry) {
  let flags = entry.flags;

  // the grammatical class is inside curly brackets
  const grammarClass = extractGrammarTags(flags);
  if (grammarClass) {
    flags = flags.replace(/\{[^\}]+\}/g, '');
    entry.grammarClass = grammarClass;
  }

  // abbreviated tags end with '.)'
  const abbrTags = extractAbbreviatedTags(entry.flags);
  if (abbrTags) {
    flags = flags.replace(/\([^=]+?\.\)/g, '');
    entry.tags = abbrTags;
  }

  // normal tags are inside parenthesis
  const tags = extractNormalTags(entry.flags);
  if (tags) {
    flags = flags.replace(/\([^=]+?[^\.]\)/g, '');
    entry.tags = entry.tags ?? [];
    entry.tags = [...entry.tags, ...tags];
  }
  
  // synonyms are represented in '[= ]'
  const equivalent = extractEquivalents(entry.flags);
  if (equivalent) {
    flags = flags.replace(/\[= [^\]]+\]|\(= [^\)]+\)/g, '');
    entry.equivalent = equivalent[0];
  }
  
  // pronouns are inside brackets
  const pronouns = extractPronouns(entry.flags);
  if (pronouns) {
    flags = flags.replace(/\[[^\]]+\]/g, '');
    entry.pronouns = pronouns;
  }

  // there are a few empty curly braces in the dictionary
  flags = flags.replace('{}', '');
  if (!flags.match(/^\s*$/)) {
    console.warn('Not all flags were parsed for entry: ', entry.word, '. "', flags, '"');
  }
}

// grammatical class tag processor
function extractGrammarTags(flags) {
  // cache map
  if (!extractGrammarTags.map) {
    extractGrammarTags.map = new Map();
    map.set("{prep.}", "preposition");
    map.set("{tr}", "transitive");
    map.set("{ntr}", "non-transitive");
    map.set("{tr/ntr}", ["transitive", "non-transitive"]);
    map.set("{suf.}", "suffix");
    map.set("{adv.}", "adverb");
    map.set("{pref.}", "prefix");
    map.set("{interj.}", "interjection");
    map.set("{imp}", "impersonal");
    map.set("{konj.}", "conjunction");
    map.set("{pron.}", "pronoun");
    map.set("{artiklo.}", "article");
    map.set("{artikl.}", "article");
  }

  const matches = flags.match(/\{[^\}]+\}/g);
  if (matches) {
    return matches.flatMap((m) => extractGrammarTags.map.get(m));
  }
}

// abbreviated tags processor
function extractAbbreviatedTags(flags) {
  // cache abbreviations
  if (!extractAbbreviatedTags.abbreviations) {
    extractAbbreviatedTags.abbreviations = JSON.parse(
      fs.readFileSync("acronymns.json").toString()
    );
  }

  const matches = flags.match(/\([^=]+?\.\)/g);
  if (matches) {
    const abbr = extractAbbreviatedTags.abbreviations;
    return matches
      // exclude parenthesis
      .map((m) => m.substring(1, m.length - 1))
      .map((m) => abbr.find((ab) => ab.acr === m))
      .filter((m) => m != null)
      .map((m) => m.eng);
  }
}

// normal tags processor
function extractNormalTags(flags) {
  const matches = flags.match(/\([^=]+?[^\.]\)/g);
  if (matches) {
    // exclude parenthesis
    return matches.map((m) => m.substring(1, m.length - 1));
  }
}

// synonym tags processor
function extractEquivalents(flags) {
  const matches = flags.match(/\[= [^\]]+\]|\(= [^\)]+\)/g);
  if (matches) {
    // exclude delimiters '[= ]'
    return matches.map((m) => m.substring(3, m.length - 1));
  }
}

// pronouns tags processor
function extractPronouns(flags) {
  const matches = flags.match(/\[[^\]]+\]/g);
  if (matches) {
    // exclude brackets
    return matches.map((m) => m.substring(1, m.length - 1));
  }
}
