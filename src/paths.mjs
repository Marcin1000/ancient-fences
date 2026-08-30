/**
 * Is this file a test?
 *
 * The distinction matters more than it looks. A comment in a test that links
 * to an issue is usually a regression test: it exists *because of* that bug,
 * exactly like a workaround, but the right thing to do when the bug is fixed
 * is the opposite. You keep the test. Telling someone to delete the test that
 * guards a fixed bug is the worst advice this tool could give.
 */
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|specs|e2e|fixtures?|testdata|__mocks__)(\/|$)/i;
const TEST_FILE = /(^|\/)[^/]*[._-](test|spec)\.[a-z]+$/i;

export function isTestPath(file) {
  const path = String(file).replace(/\\/g, '/');
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}
