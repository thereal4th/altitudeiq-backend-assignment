# Shortcuts for the pnpm scripts in package.json.
.PHONY: test test-unit test-integration test-e2e coverage

test:
	pnpm test

test-unit:
	pnpm test:unit

test-integration:
	pnpm test:integration

test-e2e:
	pnpm test:e2e

coverage:
	pnpm test:coverage