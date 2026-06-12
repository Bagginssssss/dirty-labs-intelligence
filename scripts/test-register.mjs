// Registers the alias/extension resolver hook for the test run.
// Used via:  node --import ./scripts/test-register.mjs --test "tests/**/*.test.ts"
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./test-loader.mjs', pathToFileURL('./scripts/').href)
