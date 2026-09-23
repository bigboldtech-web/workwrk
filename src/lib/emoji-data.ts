// The emoji list the picker renders, embedded rather than fetched.
//
// spec-talk.md section 3 asks for "search, 8 categories as 11/600 section
// labels, recent, 32px cells; embedded emoji list (no CDN)". A CDN list is
// the usual shortcut and it is wrong here for three reasons: it is a third
// party watching everyone who opens a message box, it renders an empty grid
// on a deployment behind a firewall, and it is a network round trip for a
// popover that must open instantly.
//
// This file is pure data plus two pure functions, so the picker itself has no
// logic worth testing and these do.
//
// THE SERVER ALLOWLIST IS THE AUTHORITY FOR REACTIONS, not this list.
// src/app/api/conversations/[id]/messages/[messageId]/react/route.ts accepts
// exactly ten emoji, and before Phase 4 the client's quick-reaction row could
// not even produce one of them (clap), while the picker could produce 300 the
// server would reject. `REACTION_EMOJI` below is exported FROM here and
// imported BY both sides so the two cannot drift again.

/** The ten the reaction endpoint accepts. Keep in lockstep with that route. */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅", "😮", "🙏", "🙌", "👏"] as const;

/** The three shown at rest on the message hover bar (spec-talk section 2.2). */
export const QUICK_REACTIONS = ["👍", "✅", "👀"] as const;

export interface EmojiEntry {
  /** The character itself. */
  e: string;
  /** Search words. Lowercase, space separated; the name comes first. */
  k: string;
}

export interface EmojiCategory {
  key: string;
  label: string;
  emoji: EmojiEntry[];
}

/** Eight categories, in the order the picker renders them. */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: "people",
    label: "Smileys & people",
    emoji: [
      { e: "😀", k: "grinning smile happy" },
      { e: "😃", k: "smiley happy joy" },
      { e: "😄", k: "smile happy laugh" },
      { e: "😁", k: "beaming grin" },
      { e: "😆", k: "laughing satisfied" },
      { e: "😅", k: "sweat smile relief" },
      { e: "🤣", k: "rofl rolling laughing" },
      { e: "😂", k: "joy tears laugh cry" },
      { e: "🙂", k: "slight smile" },
      { e: "🙃", k: "upside down silly" },
      { e: "😉", k: "wink" },
      { e: "😊", k: "blush smile happy" },
      { e: "😇", k: "innocent halo angel" },
      { e: "🥰", k: "hearts love adore" },
      { e: "😍", k: "heart eyes love" },
      { e: "😘", k: "kiss blowing" },
      { e: "😋", k: "yum tasty tongue" },
      { e: "😛", k: "tongue cheeky" },
      { e: "🤪", k: "zany goofy wild" },
      { e: "🤨", k: "raised eyebrow suspicious" },
      { e: "🧐", k: "monocle inspect" },
      { e: "🤓", k: "nerd glasses" },
      { e: "😎", k: "cool sunglasses" },
      { e: "🥳", k: "party face celebrate" },
      { e: "😏", k: "smirk" },
      { e: "😒", k: "unamused meh" },
      { e: "😞", k: "disappointed sad" },
      { e: "😔", k: "pensive sad" },
      { e: "😟", k: "worried" },
      { e: "🙁", k: "slight frown" },
      { e: "😣", k: "persevere struggle" },
      { e: "😫", k: "tired exhausted" },
      { e: "😩", k: "weary" },
      { e: "🥺", k: "pleading puppy eyes" },
      { e: "😢", k: "cry sad tear" },
      { e: "😭", k: "sob crying loud" },
      { e: "😤", k: "triumph huff" },
      { e: "😠", k: "angry" },
      { e: "😡", k: "rage furious" },
      { e: "🤯", k: "mind blown exploding head" },
      { e: "😳", k: "flushed surprised" },
      { e: "🥵", k: "hot overheated" },
      { e: "🥶", k: "cold freezing" },
      { e: "😱", k: "scream fear shock" },
      { e: "😨", k: "fearful" },
      { e: "😰", k: "anxious sweat" },
      { e: "🤔", k: "thinking hmm" },
      { e: "🤗", k: "hug hugging" },
      { e: "🤭", k: "oops hand over mouth" },
      { e: "🤫", k: "shush quiet secret" },
      { e: "😶", k: "no mouth speechless" },
      { e: "😐", k: "neutral" },
      { e: "😑", k: "expressionless" },
      { e: "😬", k: "grimace awkward" },
      { e: "🙄", k: "eye roll" },
      { e: "😴", k: "sleeping zzz" },
      { e: "🤤", k: "drooling" },
      { e: "🤒", k: "sick thermometer" },
      { e: "🤕", k: "injured bandage" },
      { e: "🤮", k: "vomit sick" },
      { e: "🥱", k: "yawn bored" },
      { e: "😮", k: "open mouth wow surprised" },
      { e: "😯", k: "hushed" },
      { e: "😲", k: "astonished" },
      { e: "👶", k: "baby" },
      { e: "🧑", k: "person adult" },
      { e: "👩", k: "woman" },
      { e: "👨", k: "man" },
      { e: "🧓", k: "older person" },
      { e: "👮", k: "police officer" },
      { e: "🕵️", k: "detective spy" },
      { e: "👷", k: "construction worker" },
      { e: "🧑‍💻", k: "technologist developer coding" },
      { e: "🧑‍🍳", k: "cook chef" },
      { e: "🧑‍🎓", k: "student graduate" },
      { e: "🎅", k: "santa" },
      { e: "🦸", k: "superhero" },
      { e: "🧘", k: "meditate yoga calm" },
    ],
  },
  {
    key: "gestures",
    label: "Gestures & body",
    emoji: [
      { e: "👍", k: "thumbs up yes approve like +1" },
      { e: "👎", k: "thumbs down no disapprove -1" },
      { e: "👏", k: "clap applause bravo" },
      { e: "🙌", k: "raised hands celebrate praise" },
      { e: "👐", k: "open hands" },
      { e: "🤲", k: "palms up" },
      { e: "🤝", k: "handshake deal agree" },
      { e: "🙏", k: "pray thanks please" },
      { e: "✌️", k: "victory peace" },
      { e: "🤞", k: "fingers crossed luck" },
      { e: "🤟", k: "love you" },
      { e: "🤘", k: "rock on horns" },
      { e: "👌", k: "ok perfect" },
      { e: "🤌", k: "pinched fingers" },
      { e: "👈", k: "point left" },
      { e: "👉", k: "point right" },
      { e: "👆", k: "point up" },
      { e: "👇", k: "point down" },
      { e: "☝️", k: "index up one" },
      { e: "✋", k: "raised hand stop" },
      { e: "🖐️", k: "hand fingers splayed" },
      { e: "🖖", k: "vulcan salute spock" },
      { e: "👋", k: "wave hello hi bye" },
      { e: "🤙", k: "call me shaka" },
      { e: "💪", k: "muscle strong flex" },
      { e: "🦾", k: "mechanical arm" },
      { e: "✍️", k: "writing hand" },
      { e: "👀", k: "eyes look watching seen" },
      { e: "👁️", k: "eye" },
      { e: "🧠", k: "brain smart" },
      { e: "👂", k: "ear listen" },
      { e: "👃", k: "nose" },
    ],
  },
  {
    key: "nature",
    label: "Animals & nature",
    emoji: [
      { e: "🐶", k: "dog puppy" },
      { e: "🐱", k: "cat kitten" },
      { e: "🐭", k: "mouse" },
      { e: "🐹", k: "hamster" },
      { e: "🐰", k: "rabbit bunny" },
      { e: "🦊", k: "fox" },
      { e: "🐻", k: "bear" },
      { e: "🐼", k: "panda" },
      { e: "🐨", k: "koala" },
      { e: "🐯", k: "tiger" },
      { e: "🦁", k: "lion" },
      { e: "🐮", k: "cow" },
      { e: "🐷", k: "pig" },
      { e: "🐸", k: "frog" },
      { e: "🐵", k: "monkey" },
      { e: "🙈", k: "see no evil monkey" },
      { e: "🐔", k: "chicken" },
      { e: "🐧", k: "penguin" },
      { e: "🐦", k: "bird" },
      { e: "🦆", k: "duck" },
      { e: "🦉", k: "owl" },
      { e: "🐝", k: "bee honey" },
      { e: "🦋", k: "butterfly" },
      { e: "🐛", k: "bug caterpillar" },
      { e: "🐌", k: "snail slow" },
      { e: "🐢", k: "turtle slow" },
      { e: "🐍", k: "snake" },
      { e: "🐙", k: "octopus" },
      { e: "🐠", k: "fish tropical" },
      { e: "🐬", k: "dolphin" },
      { e: "🐳", k: "whale" },
      { e: "🦄", k: "unicorn" },
      { e: "🌵", k: "cactus" },
      { e: "🌲", k: "evergreen tree" },
      { e: "🌳", k: "tree" },
      { e: "🌴", k: "palm tree" },
      { e: "🌱", k: "seedling growth" },
      { e: "🌿", k: "herb leaf" },
      { e: "🍀", k: "four leaf clover luck" },
      { e: "🍁", k: "maple leaf autumn" },
      { e: "🌸", k: "cherry blossom flower" },
      { e: "🌻", k: "sunflower" },
      { e: "🌹", k: "rose flower" },
      { e: "🌈", k: "rainbow" },
      { e: "☀️", k: "sun sunny" },
      { e: "⛅", k: "cloud sun partly" },
      { e: "☁️", k: "cloud" },
      { e: "🌧️", k: "rain" },
      { e: "⛈️", k: "storm thunder" },
      { e: "❄️", k: "snowflake cold" },
      { e: "🔥", k: "fire hot lit burn" },
      { e: "💧", k: "droplet water" },
      { e: "🌊", k: "wave ocean" },
      { e: "⭐", k: "star" },
      { e: "🌙", k: "moon night" },
    ],
  },
  {
    key: "food",
    label: "Food & drink",
    emoji: [
      { e: "🍏", k: "green apple" },
      { e: "🍎", k: "apple" },
      { e: "🍌", k: "banana" },
      { e: "🍉", k: "watermelon" },
      { e: "🍇", k: "grapes" },
      { e: "🍓", k: "strawberry" },
      { e: "🫐", k: "blueberries" },
      { e: "🍑", k: "peach" },
      { e: "🍍", k: "pineapple" },
      { e: "🥑", k: "avocado" },
      { e: "🍅", k: "tomato" },
      { e: "🥕", k: "carrot" },
      { e: "🌽", k: "corn" },
      { e: "🥦", k: "broccoli" },
      { e: "🍞", k: "bread" },
      { e: "🥐", k: "croissant" },
      { e: "🧀", k: "cheese" },
      { e: "🥚", k: "egg" },
      { e: "🍔", k: "burger hamburger" },
      { e: "🍟", k: "fries chips" },
      { e: "🍕", k: "pizza" },
      { e: "🌮", k: "taco" },
      { e: "🌯", k: "burrito wrap" },
      { e: "🍜", k: "noodles ramen" },
      { e: "🍣", k: "sushi" },
      { e: "🍱", k: "bento lunch" },
      { e: "🍛", k: "curry rice" },
      { e: "🥗", k: "salad" },
      { e: "🍦", k: "ice cream" },
      { e: "🍰", k: "cake slice" },
      { e: "🎂", k: "birthday cake" },
      { e: "🍪", k: "cookie biscuit" },
      { e: "🍫", k: "chocolate" },
      { e: "🍩", k: "donut" },
      { e: "☕", k: "coffee tea hot drink" },
      { e: "🍵", k: "green tea" },
      { e: "🧋", k: "bubble tea" },
      { e: "🍺", k: "beer" },
      { e: "🍻", k: "cheers beers" },
      { e: "🥂", k: "champagne cheers toast" },
      { e: "🍷", k: "wine" },
      { e: "🥤", k: "soft drink cup" },
      { e: "🧊", k: "ice cube" },
    ],
  },
  {
    key: "activity",
    label: "Activity",
    emoji: [
      { e: "⚽", k: "football soccer" },
      { e: "🏀", k: "basketball" },
      { e: "🏈", k: "american football" },
      { e: "⚾", k: "baseball" },
      { e: "🎾", k: "tennis" },
      { e: "🏐", k: "volleyball" },
      { e: "🏓", k: "table tennis ping pong" },
      { e: "🏸", k: "badminton" },
      { e: "🥊", k: "boxing" },
      { e: "🏹", k: "bow arrow archery" },
      { e: "🎯", k: "target bullseye direct hit" },
      { e: "🎳", k: "bowling" },
      { e: "🏆", k: "trophy win champion" },
      { e: "🥇", k: "first place gold medal" },
      { e: "🥈", k: "second place silver" },
      { e: "🥉", k: "third place bronze" },
      { e: "🏅", k: "medal" },
      { e: "🎖️", k: "military medal" },
      { e: "🎮", k: "game controller" },
      { e: "🎲", k: "dice game" },
      { e: "🧩", k: "puzzle piece" },
      { e: "🎨", k: "art palette design" },
      { e: "🎤", k: "microphone sing" },
      { e: "🎧", k: "headphones music" },
      { e: "🎸", k: "guitar" },
      { e: "🥁", k: "drum" },
      { e: "🎬", k: "clapper film movie" },
      { e: "🎭", k: "theatre masks" },
      { e: "🏃", k: "running run" },
      { e: "🚴", k: "cycling bike" },
      { e: "🏊", k: "swimming swim" },
      { e: "⛷️", k: "skiing" },
      { e: "🧗", k: "climbing" },
      { e: "🎉", k: "party popper celebrate tada hooray" },
      { e: "🎊", k: "confetti ball celebrate" },
      { e: "🎈", k: "balloon" },
      { e: "🎁", k: "gift present" },
      { e: "🎆", k: "fireworks" },
    ],
  },
  {
    key: "travel",
    label: "Travel & places",
    emoji: [
      { e: "🚗", k: "car" },
      { e: "🚕", k: "taxi" },
      { e: "🚌", k: "bus" },
      { e: "🚑", k: "ambulance" },
      { e: "🚒", k: "fire engine" },
      { e: "🚜", k: "tractor" },
      { e: "🏍️", k: "motorcycle" },
      { e: "🚲", k: "bicycle bike" },
      { e: "🛴", k: "scooter" },
      { e: "✈️", k: "airplane flight travel" },
      { e: "🚀", k: "rocket launch ship fast" },
      { e: "🛸", k: "ufo" },
      { e: "🚁", k: "helicopter" },
      { e: "⛵", k: "sailboat" },
      { e: "🚢", k: "ship" },
      { e: "🚂", k: "train steam" },
      { e: "🚇", k: "metro subway" },
      { e: "🗺️", k: "map world" },
      { e: "🧭", k: "compass" },
      { e: "🏔️", k: "mountain snow" },
      { e: "🏝️", k: "desert island beach" },
      { e: "🏖️", k: "beach umbrella holiday" },
      { e: "🏕️", k: "camping tent" },
      { e: "🏠", k: "house home" },
      { e: "🏢", k: "office building" },
      { e: "🏭", k: "factory" },
      { e: "🏦", k: "bank" },
      { e: "🏥", k: "hospital" },
      { e: "🏫", k: "school" },
      { e: "🗼", k: "tower tokyo" },
      { e: "🗽", k: "statue of liberty" },
      { e: "🌉", k: "bridge night" },
      { e: "🌍", k: "earth globe europe africa world" },
      { e: "🌎", k: "earth globe americas world" },
      { e: "🌏", k: "earth globe asia world" },
    ],
  },
  {
    key: "objects",
    label: "Objects",
    emoji: [
      { e: "💻", k: "laptop computer" },
      { e: "🖥️", k: "desktop computer monitor" },
      { e: "⌨️", k: "keyboard" },
      { e: "🖱️", k: "mouse computer" },
      { e: "📱", k: "phone mobile" },
      { e: "☎️", k: "telephone call" },
      { e: "📞", k: "phone receiver call" },
      { e: "📷", k: "camera photo" },
      { e: "🎥", k: "video camera movie" },
      { e: "🔋", k: "battery" },
      { e: "🔌", k: "plug power" },
      { e: "💡", k: "light bulb idea" },
      { e: "🔦", k: "torch flashlight" },
      { e: "🔒", k: "lock private secure closed" },
      { e: "🔓", k: "unlock open" },
      { e: "🔑", k: "key access" },
      { e: "🔨", k: "hammer build fix" },
      { e: "🛠️", k: "tools maintenance" },
      { e: "🔧", k: "wrench fix" },
      { e: "⚙️", k: "gear settings cog" },
      { e: "🧲", k: "magnet" },
      { e: "📦", k: "package box shipped" },
      { e: "📬", k: "mailbox mail" },
      { e: "✉️", k: "email envelope mail" },
      { e: "📝", k: "memo note write" },
      { e: "📄", k: "page document file" },
      { e: "📊", k: "bar chart report data" },
      { e: "📈", k: "chart up growth increase" },
      { e: "📉", k: "chart down decrease" },
      { e: "📋", k: "clipboard list" },
      { e: "📌", k: "pin pushpin" },
      { e: "📎", k: "paperclip attach" },
      { e: "🗂️", k: "dividers folders" },
      { e: "🗓️", k: "calendar date" },
      { e: "⏰", k: "alarm clock time" },
      { e: "⏳", k: "hourglass waiting time" },
      { e: "🔍", k: "search magnifying glass find" },
      { e: "🔎", k: "search magnifying right" },
      { e: "💰", k: "money bag" },
      { e: "💳", k: "credit card payment" },
      { e: "🧾", k: "receipt invoice" },
      { e: "🎓", k: "graduation cap learning" },
      { e: "📚", k: "books library docs" },
      { e: "🧪", k: "test tube experiment" },
      { e: "🩺", k: "stethoscope health" },
      { e: "🪑", k: "chair seat" },
      { e: "🛎️", k: "bell service" },
    ],
  },
  {
    key: "symbols",
    label: "Symbols",
    emoji: [
      { e: "❤️", k: "red heart love" },
      { e: "🧡", k: "orange heart" },
      { e: "💛", k: "yellow heart" },
      { e: "💚", k: "green heart" },
      { e: "💙", k: "blue heart" },
      { e: "💜", k: "purple heart" },
      { e: "🖤", k: "black heart" },
      { e: "💔", k: "broken heart" },
      { e: "💯", k: "hundred perfect score" },
      { e: "✅", k: "check mark done yes complete" },
      { e: "☑️", k: "ballot check tick" },
      { e: "✔️", k: "check tick" },
      { e: "❌", k: "cross no wrong" },
      { e: "❗", k: "exclamation important" },
      { e: "❓", k: "question" },
      { e: "⚠️", k: "warning caution" },
      { e: "🚫", k: "prohibited no entry" },
      { e: "⛔", k: "no entry stop" },
      { e: "🔴", k: "red circle" },
      { e: "🟠", k: "orange circle" },
      { e: "🟡", k: "yellow circle" },
      { e: "🟢", k: "green circle" },
      { e: "🔵", k: "blue circle" },
      { e: "⚫", k: "black circle" },
      { e: "⚪", k: "white circle" },
      { e: "🔺", k: "red triangle up" },
      { e: "🔻", k: "red triangle down" },
      { e: "🔔", k: "bell notification" },
      { e: "🔕", k: "bell off mute" },
      { e: "➕", k: "plus add" },
      { e: "➖", k: "minus" },
      { e: "✖️", k: "multiply times" },
      { e: "➗", k: "divide" },
      { e: "♻️", k: "recycle" },
      { e: "🔁", k: "repeat loop" },
      { e: "▶️", k: "play" },
      { e: "⏸️", k: "pause" },
      { e: "⏹️", k: "stop" },
      { e: "⏭️", k: "next skip" },
      { e: "🔗", k: "link chain url" },
      { e: "💬", k: "speech balloon comment message" },
      { e: "💭", k: "thought balloon" },
      { e: "🗯️", k: "anger balloon" },
      { e: "⭕", k: "circle hollow red" },
      { e: "🆗", k: "ok button" },
      { e: "🆕", k: "new" },
      { e: "🔝", k: "top up" },
      { e: "🈵", k: "no vacancy full" },
    ],
  },
];

/** Every emoji in one flat array, in category order. */
export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emoji);

/**
 * Search. An empty query means "no filtering, use the categories"; the picker
 * decides that, so this always returns matches for whatever it is handed.
 *
 * A match is a keyword-prefix match, not a substring match anywhere: typing
 * "car" should reach "carrot" and "car", not "scarf". The emoji character
 * itself also matches, so pasting one finds it.
 */
export function searchEmoji(query: string, limit = 60): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const entry of ALL_EMOJI) {
    if (entry.e === q) { starts.unshift(entry); continue; }
    const words = entry.k.split(" ");
    if (words.some((w) => w.startsWith(q))) starts.push(entry);
    else if (entry.k.includes(q)) contains.push(entry);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Fold a new pick into the recent list: most recent first, no duplicates,
 * capped. Pure, so the picker's localStorage read and write stay two lines.
 */
export function pushRecent(recent: string[], emoji: string, cap = 24): string[] {
  const next = [emoji, ...recent.filter((r) => r !== emoji)];
  return next.slice(0, cap);
}

/** Parse the stored recent list defensively: storage can hold anything. */
export function parseRecent(raw: string | null, cap = 24): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 16).slice(0, cap);
  } catch {
    return [];
  }
}
