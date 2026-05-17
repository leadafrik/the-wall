export const metadata = {
  title: 'about · the wall',
};

export default function About() {
  return (
    <main className="about">
      <div className="about__inner">
        the wall is a place where words go when they have nowhere else to go.
        no names. no accounts. just what you’re carrying — left here for anyone
        who needs to know they’re not the only one carrying it. write something.
        read something. move on. the wall remembers.
        <a className="about__back" href="/">← back to the wall</a>
      </div>
    </main>
  );
}
