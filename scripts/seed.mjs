// Seed the wall with 40 anonymous notes.
//
// Run with:
//   node --env-file=.env.local scripts/seed.mjs
//
// Inserts directly via the service-role key, so the API moderation, rate
// limit, and bot defenses are not touched. Each note is tagged ip_hash='seed'
// so you can identify and bulk-delete them later if needed:
//   delete from notes where ip_hash = 'seed';

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing SUPABASE_URL or SERVICE_ROLE_KEY — pass --env-file=.env.local');
  process.exit(1);
}

const SECTION_COLORS = {
  venting:         ['#fffbe6', '#fff2a1', '#ffe066', '#f0d878', '#e8c547'],
  ideas:           ['#edf7ed', '#c8e6c9', '#a5d6a7', '#d4e9b8', '#b5cf90'],
  memory:          ['#fff3e0', '#ffe0b2', '#ffccbc', '#fad7b2', '#f1c89e'],
  'things unsaid': ['#fce4ec', '#f8bbd0', '#f4a8c0', '#edc5cf', '#e8b3c2'],
  confessions:     ['#ede7f6', '#d1c4e9', '#b39ddb', '#c5b3df', '#bca0c7'],
};

const CANVAS_SIZE = 10_000;
const CENTER = CANVAS_SIZE / 2;
// Mirror of src/lib/placement.ts — keep these in sync with that file
// and with place_note()'s defaults in supabase/schema.sql.
const NO_OVERLAP_X = 175;
const NO_OVERLAP_Y = 320;
const MIN_OFFSET = 340;
const MAX_OFFSET = 520;
const MAX_ATTEMPTS = 60;

const NOTES = [
  // venting
  { section: 'venting', text: 'my mom called again to ask if im still single. like its a project im behind on' },
  { section: 'venting', text: 'spent 4 hours on the phone with insurance today. they keep saying my claim is being processed. it has been 7 months' },
  { section: 'venting', text: 'my boss said i was doing great in front of the whole team and 20 minutes later told me i need to grow up. cant tell which one was real' },
  { section: 'venting', text: 'im so tired of pretending to love this job. everyone here talks about purpose. im just trying to make rent' },
  { section: 'venting', text: 'neighbor upstairs has been doing what i can only describe as bowling. every night at 11pm this whole week' },
  { section: 'venting', text: 'i wasted my entire twenties trying to be impressive to people who dont remember my name' },
  { section: 'venting', text: 'why do doctors always look surprised when i tell them the pain is actually bad' },
  { section: 'venting', text: 'been crying in my car between meetings for almost three months and nobody at this job has noticed' },

  // ideas
  { section: 'ideas', text: 'what if streetlights got slightly dimmer the later it got. like the city was whispering go home' },
  { section: 'ideas', text: 'there should be a word for finding an old playlist from someone you used to be' },
  { section: 'ideas', text: 'cafe but only people who are alone. no wifi. you have to make eye contact with one stranger before you leave' },
  { section: 'ideas', text: 'every apartment should come with a hidden room nobody told you about. just a small one. for reading or hiding' },
  { section: 'ideas', text: 'what if grocery stores had a clearly marked quiet hour and a loud hour. i would only ever go during the quiet one' },
  { section: 'ideas', text: 'someone should make a phone that only works between 8am and 8pm. battery dies otherwise. for our own good' },
  { section: 'ideas', text: 'i want a job where i show up to weddings i wasnt invited to and dance well enough that nobody asks who i am' },
  { section: 'ideas', text: 'an app where you say what you have in your fridge and it tells you which neighbor you should give it to' },

  // memory
  { section: 'memory', text: 'my grandma always put the kettle on before saying hello. the visit didnt start until the water was on' },
  { section: 'memory', text: 'the way the sun hit the carpet in our old apartment at 4pm. i thought every apartment had that light. they dont' },
  { section: 'memory', text: 'dad teaching me how to drive in the church parking lot. he was so calm. i didnt know he was scared until much later' },
  { section: 'memory', text: 'the smell of my high school boyfriends hoodie. acrylic paint and clean laundry. i would know it anywhere' },
  { section: 'memory', text: 'eating cereal at 2am with my sister the week after our mom died. neither of us could sleep. we didnt talk. it was enough' },
  { section: 'memory', text: 'there was a stray cat behind our chicago building that only my brother could pet. she would hiss at everyone else. she chose him' },
  { section: 'memory', text: 'i told my best friend in fourth grade that i loved her best. she said she loved kayla best and me second. i still remember what she was wearing' },
  { section: 'memory', text: 'my granddad said right then before he did anything. doing the dishes. standing up from a chair. right then.' },

  // things unsaid
  { section: 'things unsaid', text: 'i never told my brother how much it meant that he sat with me at the hospital. he probably doesnt remember. i remember every minute' },
  { section: 'things unsaid', text: 'mom i know you read my journal when i was 14. i never said anything but it changed how i felt about you for years' },
  { section: 'things unsaid', text: 'i loved you the whole time. even after you got married. even after your kids. im sorry' },
  { section: 'things unsaid', text: 'dad i didnt actually want to study engineering. i went because you were proud and i didnt know how to disappoint you. its been 12 years' },
  { section: 'things unsaid', text: 'to my old roommate. you stole from me. i knew the whole time. i just didnt want to make it weird' },
  { section: 'things unsaid', text: 'you were not actually my best friend. you were just the only person who would call me back. i think youre still like that with someone else' },
  { section: 'things unsaid', text: 'when you said you missed me i wanted to say i missed you more. i was scared so i said yeah me too. i meant so much more than that' },
  { section: 'things unsaid', text: 'i never told her i loved her back because i thought we had time. we didnt. its been three years' },

  // confessions
  { section: 'confessions', text: 'i hope my coworker doesnt get the promotion before me. i would be happy for her on the outside but inside i would crumble' },
  { section: 'confessions', text: 'i lied on my resume for years. nobody ever checked. i kept getting promoted. i still wonder what im actually capable of' },
  { section: 'confessions', text: 'sometimes i feel real relief when plans get cancelled. even with people i love. then i feel terrible. then i feel relief again' },
  { section: 'confessions', text: 'i havent told my wife that i lost my job. its been 6 weeks. i leave the house every morning. i dont know how to undo this' },
  { section: 'confessions', text: 'my dog died last year and i still havent told my parents. they keep asking how she is. i keep saying shes doing good' },
  { section: 'confessions', text: 'i secretly hated my own wedding. every single thing about it. i was acting the entire day' },
  { section: 'confessions', text: 'ive been reading my husbands texts for 4 years. he has never done anything wrong. i cant make myself stop' },
  { section: 'confessions', text: 'i prayed for my grandfather to die at the end. i couldnt watch him suffer anymore. i still dont know if that was love' },
];

function randBetween(min, max) {
  return Math.random() * (max - min) + min;
}

// Mirror of src/lib/placement.ts — no edge clamp (the wall scrolls forever),
// stricter collision check so notes don't cover each other's text.
function overlapsAny(existing, x, y) {
  for (const n of existing) {
    if (Math.abs(n.x - x) < NO_OVERLAP_X && Math.abs(n.y - y) < NO_OVERLAP_Y) {
      return true;
    }
  }
  return false;
}

function pickPlacement(existing) {
  const rotation = +randBetween(-4, 4).toFixed(2);
  const z_index = Math.floor(Math.random() * 1000);
  if (existing.length === 0) {
    return {
      x: Math.round(CENTER + randBetween(-200, 200)),
      y: Math.round(CENTER + randBetween(-200, 200)),
      rotation,
      z_index,
    };
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = randBetween(MIN_OFFSET, MAX_OFFSET) + attempt * 24;
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }
  // Hard escape — keep checking overlap as we push further out.
  for (let escape = 0; escape < 20; escape++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = MAX_OFFSET + 1500 + escape * 200 + randBetween(0, 200);
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }
  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.round(anchor.x + Math.cos(angle) * 5000),
    y: Math.round(anchor.y + Math.sin(angle) * 5000),
    rotation,
    z_index,
  };
}

async function main() {
  const reset = process.argv.includes('--reset');
  const purge = process.argv.includes('--purge');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: existingSeedCount } = await supabase
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', 'seed');

  // --purge: just delete the seeded notes and exit. Real user notes
  // (any ip_hash that isn't literally 'seed') are untouched.
  if (purge) {
    if ((existingSeedCount ?? 0) === 0) {
      console.log('no seed notes to purge — already clean.');
      return;
    }
    console.log(`--purge: deleting ${existingSeedCount} seed notes…`);
    const { error: delErr } = await supabase
      .from('notes')
      .delete()
      .eq('ip_hash', 'seed');
    if (delErr) {
      console.error('delete failed:', delErr.message);
      process.exit(1);
    }
    console.log('done.');
    return;
  }

  if ((existingSeedCount ?? 0) > 0) {
    if (!reset) {
      console.error(`already seeded — found ${existingSeedCount} seed notes.`);
      console.error(`options:`);
      console.error(`  --reset  delete and re-insert the 40 seed notes`);
      console.error(`  --purge  delete the seed notes and exit (leaves real notes)`);
      process.exit(1);
    }
    console.log(`--reset: deleting ${existingSeedCount} existing seed notes…`);
    const { error: delErr } = await supabase
      .from('notes')
      .delete()
      .eq('ip_hash', 'seed');
    if (delErr) {
      console.error('delete failed:', delErr.message);
      process.exit(1);
    }
  }

  // Anchor new placements off whatever notes already exist (none, or real user notes).
  const { data: existing } = await supabase
    .from('notes')
    .select('x, y')
    .limit(400);
  const positions = (existing ?? []).map((n) => ({ x: n.x, y: n.y }));

  let inserted = 0;
  for (const note of NOTES) {
    const palette = SECTION_COLORS[note.section];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const placement = pickPlacement(positions);

    const row = {
      text: note.text,
      section: note.section,
      color,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      z_index: placement.z_index,
      ip_hash: 'seed',
      flagged: false,
    };

    const { data, error } = await supabase
      .from('notes')
      .insert(row)
      .select('x, y')
      .single();

    if (error) {
      console.error(`  ✗ ${note.section}: ${error.message}`);
      console.error(`    text: ${note.text.slice(0, 60)}${note.text.length > 60 ? '…' : ''}`);
      continue;
    }
    positions.push({ x: data.x, y: data.y });
    inserted++;
    const preview = note.text.length > 50 ? note.text.slice(0, 50) + '…' : note.text;
    console.log(`  (${String(inserted).padStart(2)}/${NOTES.length}) ${note.section.padEnd(14)} ${preview}`);
  }

  console.log(`\nseeded ${inserted} / ${NOTES.length} notes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
