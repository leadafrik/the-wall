export const metadata = {
  title: 'privacy · the wall',
};

export default function Privacy() {
  return (
    <main className="legal">
      <article className="legal__inner">
        <p className="legal__lede">
          the wall is built to know almost nothing about you.
        </p>

        <h2>what we keep</h2>
        <p>
          the text of what you write. the section you wrote in. a one-way
          hash of your ip address — used to rate-limit posting, never
          reversed back to an ip. a timestamp. that’s everything.
        </p>

        <h2>what we don’t keep</h2>
        <p>
          no accounts. no usernames. no emails. no profiles. no analytics. no
          third-party trackers. no ads. no browser fingerprinting. no way to
          tie a note back to the person who wrote it.
        </p>

        <h2>cookies</h2>
        <p>
          one small signed cookie so the wall knows you’re a real browser
          and not a scraper. that’s the only cookie we set. no third party
          sets cookies through us.
        </p>

        <h2>captcha</h2>
        <p>
          we use cloudflare turnstile to keep bots out of the composer. it
          runs invisibly for almost everyone, doesn’t set tracking cookies,
          and doesn’t share your identity with us. cloudflare’s own privacy
          notice covers what it does on their side.
        </p>

        <h2>how long it stays</h2>
        <p>
          notes stay on the wall as long as the wall does. seed notes
          auto-retire after a while. you can ask us to remove a specific note —
          see the <a href="/legal/takedown">takedown page</a>.
        </p>

        <h2>requests under gdpr / ccpa</h2>
        <p>
          there’s almost nothing we could give you, since nothing on the wall
          is linked to your identity. if you wrote a note you’d like removed,
          the takedown page is the right place. if you have a legal request
          we haven’t covered here, email{' '}
          <a href="mailto:contact@humanitywall.org">contact@humanitywall.org</a>.
        </p>

        <h2>changes</h2>
        <p>
          if any of this changes, this page changes with it.
        </p>

        <a className="legal__back" href="/about">← back</a>
      </article>
    </main>
  );
}
