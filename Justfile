_:
    @just help

# List available commands
help:
    @just --list

# Install dependencies and Git hooks, then verify the project
setup:
    bun install
    pre-commit install
    bun run verify

# Install the extension into Pi
install:
    pi install .

# Format code
format:
    bun run format

# Check code for lint issues
lint:
    bun run lint

# Run tests
test:
    bun run test

# Static type check with TypeScript
typecheck:
    bun run typecheck

# Run source checks
check:
    bun run check

# Run all checks, including the packaged artifact check
verify:
    bun run verify

# Check the packaged artifact contract
package-check:
    bun run test:package

# Run tests with coverage
coverage:
    bun run coverage

# Apply automatic lint fixes and format code
fix:
    bun run lint:fix
    bun run format

# Remove coverage and temporary output
clean:
    rm -rf coverage

alias cov := coverage
alias fmt := format
alias tsc := typecheck
