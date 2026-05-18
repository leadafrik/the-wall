export const metadata = {
  title: 'terms · the wall',
};

export default function Terms() {
  return (
    <main className="legal">
      <article className="legal__inner">
        <p className="legal__lede">
          the wall is open to anyone, anonymous by design. these are the few
          things we ask.
        </p>

        <h2>what to leave on the wall</h2>
        <p>
          things you carry. honest words. your own writing.
        </p>

        <h2>what not to leave on the wall</h2>
        <p>
          threats aimed at specific people. anything sexual involving minors.
          slurs aimed at groups. doxxing — anyone’s real name, address, phone,
          workplace. spam. promotional links. someone else’s writing typed out
          as if it’s yours.
        </p>

        <h2>what we’ll do</h2>
        <p>
          we don’t read every note. we do read the ones that get flagged, and
          the moderation pipeline catches some things automatically. when a
          note crosses a line, it comes down. we try to be fair about it. we
          don’t owe an explanation, but we’ll usually give one if you ask.
        </p>

        <h2>what we won’t do</h2>
        <p>
          sell your data — there is no data to sell. we don’t have your name,
          your email, or any way to find you. that’s the point.
        </p>

        <h2>what you should know</h2>
        <p>
          the wall is provided as-is. it’s a small thing kept running by
          people who care about it. it might break. it might pause. it might
          one day go away. while it’s here, we’ll do our best by it and by
          you.
        </p>

        <h2>if you’re unhappy</h2>
        <p>
          email <a href="mailto:contact@humanitywall.org">contact@humanitywall.org</a>.
          we read everything that comes in, even when we don’t reply right
          away.
        </p>

        <a className="legal__back" href="/about">← back</a>
      </article>
    </main>
  );
}
