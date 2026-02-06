# Contributing to Kubernetes Policy Hub

Thank you for your interest in contributing to Kubernetes Policy Hub! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/kubenetlabs/kph/issues) to avoid duplicates.

When creating a bug report, include:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Environment details (OS, browser, Kubernetes version, etc.)
- Screenshots or logs if applicable

### Suggesting Features

Feature requests are welcome! Please:
- Check existing issues and discussions first
- Describe the use case and why it would be valuable
- Consider how it fits with existing functionality

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Set up the development environment**:
   ```bash
   npm install
   npx prisma generate
   npm run dev
   ```
3. **Make your changes** following our coding standards
4. **Write or update tests** for your changes
5. **Run the test suite**: `npm run test:run`
6. **Run linting**: `npm run lint`
7. **Submit your PR** with a clear description

## Development Setup

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- PostgreSQL (or use the embedded database)

### Quick Start

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/kph.git
cd kph

# Install dependencies
npm install

# Start with Docker Compose (includes PostgreSQL)
docker compose up -d

# Run database migrations
npx prisma db push

# Start development server
npm run dev
```

### Running Tests

```bash
# Run all tests
npm run test:run

# Run tests in watch mode
npm run test

# Run with coverage
npm run test:coverage
```

### Code Style

- **TypeScript**: We use strict TypeScript with ESLint
- **Formatting**: Follow existing patterns in the codebase
- **Components**: Functional components with hooks
- **API**: tRPC for type-safe APIs

### Commit Messages

We follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test changes
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

Example: `feat: add OIDC authentication provider`

## Project Structure

```
├── src/
│   ├── app/           # Next.js App Router pages
│   ├── components/    # React components
│   ├── lib/           # Shared utilities
│   │   ├── auth/      # Auth provider abstraction
│   │   ├── email/     # Email provider abstraction
│   │   └── llm/       # LLM provider abstraction
│   ├── server/        # tRPC routers
│   └── test/          # Test utilities
├── prisma/            # Database schema
├── charts/            # Helm chart
└── operator/          # Go-based Kubernetes operator
```

## Getting Help

- [GitHub Discussions](https://github.com/kubenetlabs/kph/discussions) for questions
- [GitHub Issues](https://github.com/kubenetlabs/kph/issues) for bugs and features

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
