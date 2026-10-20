try {
  const r = await fetch("http://127.0.0.1:3001/game-audio/v1/health", {
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) process.exit(1);
} catch {
  process.exit(1);
}
