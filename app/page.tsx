export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem 2rem", maxWidth: 640, margin: "0 auto" }}>
      <h1>InfathomReel</h1>
      <p>
        DM a Reel to <strong>@infathomreel.ai</strong> on Instagram and get back a breakdown of
        whether it&apos;s true, what&apos;s questionable, what it links to, and what it&apos;s
        actually trying to say.
      </p>
      <p style={{ color: "#666" }}>
        Webhook endpoint: <code>/api/webhook</code>
      </p>
    </main>
  );
}
