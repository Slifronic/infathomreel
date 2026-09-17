export default function Privacy() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem 2rem", maxWidth: 640, margin: "0 auto", lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p>
        InfathomReel is a personal automation tool. When a Reel is sent to{" "}
        <strong>@infathomreel.ai</strong> on Instagram, this app downloads the
        video from Meta&apos;s API, sends it to an AI model for analysis, and
        replies with the result in the same conversation.
      </p>
      <p>
        Video content and message metadata are processed only to generate
        that reply. They are not stored persistently, sold, or shared with
        any third party beyond the AI model used to analyze the content.
      </p>
      <p>
        This tool is operated by a single individual for personal use and is
        not a public product or service.
      </p>
      <p>
        Contact: <a href="mailto:bryguy.vo@gmail.com">bryguy.vo@gmail.com</a>
      </p>
    </main>
  );
}
