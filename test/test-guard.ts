/**
 * Test environment guard — prevents test execution outside the Clawcoin test container.
 *
 * Registered as a vitest setupFile. Runs before any test suite.
 * The Docker container sets IN_CLAWCOIN_TEST_CONTAINER=1 automatically.
 */

if (process.env.IN_CLAWCOIN_TEST_CONTAINER !== "1") {
  console.error(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║  BLOCKED: Tests must run inside the Clawcoin test container.    ║
  ║                                                                  ║
  ║  Use:  docker compose -f testing/docker-compose.yml \\           ║
  ║          run test-runner npm test                                ║
  ║                                                                  ║
  ║  See testing/README.md for setup instructions.                   ║
  ║                                                                  ║
  ║  Why? Running an aggressively capable bot's test suite on your   ║
  ║  local machine poses security risks. The test container isolates ║
  ║  execution from your host environment.                           ║
  ╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}
