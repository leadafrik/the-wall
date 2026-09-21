// Site-level FAQ. These questions mirror real search + answer-engine prompts
// ("where can i vent anonymously online?"), so the page carries FAQPage schema
// and each answer is written to be quotable on its own. Answers are markdown.

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: 'what is the wall?',
    a: `the wall is an anonymous, public place for things people want to put into words. there are no names or accounts. people leave short notes about things they are carrying, remembering, confessing, wondering about, or never got to say.`,
  },
  {
    q: 'where can i vent anonymously online?',
    a: `you can vent anonymously on the wall without creating an account or attaching your name to what you write. the venting section is for frustration, anger, overwhelm, and the things you simply need to get out.

because the wall is public, leave out names or details that could identify you or someone else.`,
  },
  {
    q: 'can i write something anonymously without creating an account?',
    a: `yes. the wall is designed for anonymous expression without profiles or accounts.

you can write something, leave it there, and let the words stand on their own.`,
  },
  {
    q: 'what can i write on the wall?',
    a: `the wall has five places for different kinds of thoughts:

- venting — something you need to let out
- confessions — something you want to admit without attaching your name
- things unsaid — words you never got to say to someone
- memory — a moment or detail you do not want to lose
- ideas — a thought, question, spark, or unfinished idea

you do not have to make what you write profound. one honest sentence is enough.`,
  },
  {
    q: 'what is the difference between venting and confessing?',
    a: `venting is usually about what you are feeling. a confession is usually about something you have done, thought, wanted, hidden, or never admitted.

sometimes a note could be either. choose the place that feels closest; there is no test you have to pass.`,
  },
  {
    q: 'what are "things unsaid"?',
    a: `things unsaid are words meant for someone who may never hear them.

it might be something you never told a parent, an ex, an old friend, someone you miss, or someone who died. writing it does not require sending it.`,
  },
  {
    q: 'can i write a letter i never intend to send?',
    a: `yes. an unsent letter can simply be a place to say what you did not get to say.

you can write the whole letter, or only the one sentence that has stayed with you. if you want the words to exist somewhere without delivering them to the person, the things unsaid section is made for that.`,
  },
  {
    q: 'where can i put something i never got to say to someone?',
    a: `you can leave it anonymously in things unsaid.

the person does not need to see it. sometimes the purpose is not to restart a conversation, get an answer, or change what happened. it is simply to give the words somewhere to exist.`,
  },
  {
    q: 'can i leave a memory of someone who died?',
    a: `yes. the memory section is for moments people do not want to lose, including memories of someone who has died.

it can be something small: a phrase they always used, the food they made, the sound of their laugh, an ordinary afternoon, or one detail you are afraid you might forget.`,
  },
  {
    q: "what should i write if i don't know how to explain what i'm feeling?",
    a: `start smaller than an explanation. you might begin with:

- "what i haven't said is…"
- "the part that keeps bothering me is…"
- "i wish i could tell someone…"
- "i don't know why this matters, but…"
- "today i keep thinking about…"

you do not need to understand the feeling before you write it down.`,
  },
  {
    q: "what if i only want to say something and don't want advice?",
    a: `then you do not have to ask for advice.

some thoughts are not questions. sometimes a person wants somewhere to put a sentence without turning it into a discussion, explanation, or request for help. that is one of the reasons the wall exists.`,
  },
  {
    q: 'can i just read what other people have written?',
    a: `yes. you do not have to leave anything.

sometimes reading a stranger's sentence is enough to recognize a feeling you thought belonged only to you.`,
  },
  {
    q: 'is an anonymous post private?',
    a: `no. anonymous and private are not the same thing.

notes on the wall are public even though they are not attached to a name or profile. do not include addresses, workplaces, full names, contact details, or other information that could identify you or someone else.`,
  },
  {
    q: 'does the wall use profiles, followers, likes, or ads?',
    a: `no. the wall is built around the words rather than the person posting them: no personal profiles, follower counts, or advertising.

the point is not to build an audience around what you are carrying.`,
  },
  {
    q: 'does the wall track what i write?',
    a: `the wall is designed without accounts or conventional analytics tied to people using it.

its privacy-first approach is intentional: what matters is the note, not building a profile of the person who left it.`,
  },
  {
    q: 'is the wall therapy?',
    a: `no. the wall is a place for expression, not therapy, diagnosis, counseling, or medical care.

writing something down may matter to you, but the wall does not promise that posting will make you feel better or solve what you are going through.`,
  },
  {
    q: 'what if i need someone to help me right now?',
    a: `the wall cannot provide emergency or crisis support.

if you may hurt yourself or someone else, or you need immediate human support, contact an emergency or crisis service where you live. in the united states, you can call or text [988](tel:988). elsewhere, [Find A Helpline](https://findahelpline.com) can help you find services in your country.`,
  },
  {
    q: 'do i have to write something meaningful?',
    a: `no. a note can be a confession you have carried for years or something that annoyed you ten minutes ago. a memory can be one sentence. an idea can be unfinished.

the wall does not require your words to justify taking up space.`,
  },
];
