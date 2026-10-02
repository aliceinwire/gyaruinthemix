try {
  const response = await fetch('http://127.0.0.1:3000/api/health', {
    signal: AbortSignal.timeout(2500),
  });
  process.exit(response.ok && (await response.json()).status === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
