// Client-side rendering for the live feed page (index.html). A plain ES
// module, not compiled from TypeScript — served as-is to the browser, and
// imported directly by feed.test.ts for offline unit tests (see server.ts /
// requestHandler.ts for how it's served, same injected-reader pattern as
// index.html).

export function scoreClass(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function renderLaunch(launch) {
  const signalsHtml = launch.signals
    .map(
      (s) => `
        <div class="signal">
          <span class="signal-name">${s.name}</span>: ${s.score}
          <ul>${s.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
        </div>`,
    )
    .join("");

  return `
    <div class="launch">
      <div class="launch-header">
        <span class="mint">${launch.mint}</span>
        <span class="score ${scoreClass(launch.score)}">${launch.score}</span>
      </div>
      ${signalsHtml}
    </div>`;
}
