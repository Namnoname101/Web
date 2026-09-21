/** Cooperatively stop the isolated E2E server before Playwright's web-server
 * plugin falls back to OS process termination (which restricted Windows
 * runners may deny). A missing server already satisfies the teardown goal. */
export default async function teardown() {
  try {
    const response = await fetch('http://127.0.0.1:3100/__e2e__/shutdown', {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 202) {
      throw new Error(`E2E shutdown returned HTTP ${response.status}.`);
    }
  } catch (error) {
    if (error instanceof TypeError && error.cause && typeof error.cause === 'object'
      && 'code' in error.cause && ['ECONNREFUSED', 'ECONNRESET'].includes(error.cause.code)) return;
    throw error;
  }
}
