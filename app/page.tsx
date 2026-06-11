import AvatarCall from "@/components/AvatarCall";

export default function Home() {
  return (
    <main className="scene">
      <div className="grain" />
      <header className="topbar">
        <span className="wordmark">
          raaamp<em>.</em>
        </span>
        <nav className="topbar-meta">
          <span className="hide-sm">AI systems for scalable growth</span>
          <a
            href="https://raaamp.co/book-call"
            target="_blank"
            rel="noopener noreferrer"
          >
            Agendar llamada →
          </a>
        </nav>
      </header>
      <AvatarCall />
    </main>
  );
}
