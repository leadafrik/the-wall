export const metadata = {
  title: 'takedowns · the wall',
  description:
    'how to ask for a note to be removed from the wall — what to include, how fast we respond, and the honest limits of authorship checks on an anonymous site.',
};

export default function Takedown() {
  return (
    <main className="legal">
      <article className="legal__inner">
        <p className="legal__lede">
          if you want a note removed — because you wrote it and want it gone,
          or because it crosses a line — email us. we read everything that
          comes in.
        </p>

        <p className="legal__contact">
          <a href="mailto:contact@humanitywall.org">contact@humanitywall.org</a>
        </p>

        <h2>what to include</h2>
        <p>
          the url of the note (visible when you click “view” on it). what the
          issue is, in a sentence or two. if it’s a copyright concern: the
          work that was copied and your relationship to it.
        </p>

        <h2>about authorship</h2>
        <p>
          the wall keeps everyone anonymous, including from us. we have no
          way to confirm a note is yours. what we do is take real requests
          seriously and ignore ones that look like bulk deletion or
          pattern-targeted vandalism. if a note is plausibly yours and you
          ask, it comes down.
        </p>

        <h2>how fast</h2>
        <p>
          we read everything as it comes in. most takedown requests are
          handled within a few days, often within hours. urgent things —
          threats, doxxing, anything involving a minor — we move on faster.
        </p>

        <h2>a small note on copyright</h2>
        <p>
          the wall doesn’t allow paste — every note is typed by hand, one
          character at a time. that means almost nothing on the wall is a
          verbatim copy of someone else’s writing. if you find a note that
          still infringes on something you own, we’ll take it down. you don’t
          need to file a formal notice — an email is enough.
        </p>

        <h2>for legal counsel</h2>
        <p>
          the email above is the right address for a formal dmca notice. we
          read those. if your client expects a usco-registered designated
          agent, write back and we’ll handle the matter directly with you.
        </p>

        <a className="legal__back" href="/about">← back</a>
      </article>
    </main>
  );
}
