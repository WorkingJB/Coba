// Coming-soon / marketing page for www.coba.games. Served by the prod app on
// the www host (server/index.ts host routing). Plain DOM, no framework — same
// spirit as the game client. It does two things: pitch the game, and capture a
// preview waitlist email (POST /api/waitlist). Approved emails can then create
// an account on the game host (gate in server/auth.ts). The stylesheet is
// linked from marketing.html (same pattern as the game's index.html).

// The "enter the preview" link points at the GAME host. Derive it from where
// the marketing page is being served so staging (www-test → test) and prod
// (www → app) both work without a build-time env.
function gameUrl(): string {
  const host = window.location.hostname;
  if (host === "www-test.coba.games") return "https://test.coba.games";
  return "https://app.coba.games";
}

const root = document.querySelector<HTMLDivElement>("#marketing")!;

root.innerHTML = `
  <main class="wrap">
    <header class="hero">
      <p class="badge">Coming soon · Private preview</p>
      <h1>Coba</h1>
      <p class="tagline">A 2v2 hero-based tactical card battler — fought across three zones, wrapped in a persistent faction war.</p>
    </header>

    <section class="pitch">
      <div class="card">
        <h3>Three zones, one battle</h3>
        <p>Commit your cards across three contested zones. Spread thin to take ground, or stack a wall to hold it — every turn is a read on where your opponent will push.</p>
      </div>
      <div class="card">
        <h3>Heroes with real identity</h3>
        <p>Tanks, assassins, summoners, support, spell-control and decay. Each hero plays a distinct deck and signature ability that bends the rules in its favor.</p>
      </div>
      <div class="card">
        <h3>A war that persists</h3>
        <p>Matches feed a faction war over the map. Territory you win changes what everyone can field next — the metagame moves while you play.</p>
      </div>
    </section>

    <section class="signup" id="signup">
      <h2>Join the preview</h2>
      <p>We're letting players in a wave at a time. Drop your email and we'll send an invite when your spot opens.</p>
      <form id="waitlist-form" novalidate>
        <input
          type="email"
          id="email"
          name="email"
          placeholder="you@example.com"
          autocomplete="email"
          required
          aria-label="Email address"
        />
        <button type="submit" id="submit">Request access</button>
      </form>
      <p class="form-msg" id="form-msg" role="status" aria-live="polite"></p>
      <p class="approved-note">
        Already approved? <a href="${gameUrl()}">Enter the preview →</a>
      </p>
    </section>

    <footer class="foot">© Coba</footer>
  </main>
`;

const form = root.querySelector<HTMLFormElement>("#waitlist-form")!;
const emailInput = root.querySelector<HTMLInputElement>("#email")!;
const submitBtn = root.querySelector<HTMLButtonElement>("#submit")!;
const msg = root.querySelector<HTMLParagraphElement>("#form-msg")!;

function setMsg(text: string, kind: "ok" | "error" | "") {
  msg.textContent = text;
  msg.className = `form-msg${kind ? " " + kind : ""}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMsg("Please enter a valid email address.", "error");
    return;
  }
  submitBtn.disabled = true;
  setMsg("Submitting…", "");
  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    if (res.ok) {
      form.reset();
      setMsg(data?.message ?? "You're on the list — we'll be in touch.", "ok");
    } else {
      setMsg(data?.message ?? "Something went wrong. Please try again.", "error");
    }
  } catch {
    setMsg("Network error. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
  }
});
