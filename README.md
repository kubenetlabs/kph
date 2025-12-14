# Kubernetes Policy Hub - Starter Kit

A SaaS platform for unified Kubernetes policy management. This starter kit includes the database schema, UI components, and page structure to get you building immediately.

---

## What's Included

```
kubernetes-policy-hub/
├── prisma/
│   └── schema.prisma          # Complete database schema
├── src/
│   ├── app/                   # Next.js App Router pages
│   │   ├── layout.tsx         # Root layout (dark theme)
│   │   ├── page.tsx           # Home redirect
│   │   ├── dashboard/         # Main dashboard
│   │   ├── clusters/          # Cluster management
│   │   ├── policies/          # Policy editor
│   │   └── simulation/        # Time-travel simulation
│   ├── components/
│   │   ├── ui/                # Base UI components
│   │   ├── layout/            # App shell & navigation
│   │   └── dashboard/         # Dashboard-specific components
│   ├── lib/                   # Utilities & database client
│   └── styles/
│       └── globals.css        # Dark theme styles
├── tailwind.config.ts         # Custom color palette
├── .cursorrules               # AI context for Cursor
└── package.json               # Dependencies
```

---

## Step-by-Step Setup Guide

### Prerequisites

Before starting, install these tools:

1. **Node.js** (v18 or higher)
   - Download from: https://nodejs.org
   - Choose "LTS" version
   - Run installer, accept defaults
   - Verify: Open Terminal/Command Prompt, type `node --version`

2. **Git**
   - Mac: Open Terminal, run `xcode-select --install`
   - Windows: Download from https://git-scm.com/download/win
   - Verify: `git --version`

3. **Cursor** (AI-powered IDE)
   - Download from: https://cursor.com
   - Install and open
   - Sign in (free tier works)

4. **Claude Code** (CLI agent)
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude login
   ```

5. **PostgreSQL** (database)
   - Mac: `brew install postgresql@15 && brew services start postgresql@15`
   - Windows: Download from https://www.postgresql.org/download/windows/
   - Or use a free cloud database: https://neon.tech (recommended for beginners)

---

## Installation

### Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `kubernetes-policy-hub`
3. Keep it Private
4. Do NOT initialize with README
5. Click "Create repository"
6. Copy the repository URL (looks like: `https://github.com/YOUR_USERNAME/kubernetes-policy-hub.git`)

### Step 2: Initialize Project

Open Terminal (Mac) or Command Prompt (Windows):

```bash
# Navigate to where you want the project
cd ~/Projects   # Mac
cd C:\Projects  # Windows (create this folder first if needed)

# Create the project with create-t3-app
npx create-t3-app@latest kubernetes-policy-hub

# When prompted, select:
#   TypeScript: Yes
#   tRPC: Yes  
#   Prisma: Yes
#   NextAuth: Yes
#   Tailwind CSS: Yes
#   Initialize git: Yes
#   Install dependencies: Yes (with npm)

# Navigate into project
cd kubernetes-policy-hub
```

### Step 3: Replace Starter Files

Extract this starter kit and copy its contents into your project, replacing existing files:

```bash
# Copy all files from the starter kit into your project
# On Mac/Linux:
cp -r /path/to/policy-hub-starter/* ./

# On Windows (PowerShell):
Copy-Item -Path "C:\path\to\policy-hub-starter\*" -Destination ".\" -Recurse -Force
```

### Step 4: Install Additional Dependencies

```bash
npm install @heroicons/react clsx date-fns zod
npm install -D @types/node
```

### Step 5: Configure Database

Create a `.env` file in the project root:

```bash
# If using local PostgreSQL:
DATABASE_URL="postgresql://postgres:password@localhost:5432/policyhub?schema=public"

# If using Neon (recommended for beginners):
# 1. Go to https://neon.tech and create free account
# 2. Create a new project called "policyhub"
# 3. Copy the connection string from the dashboard
DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/policyhub?sslmode=require"

# NextAuth (generate a random string)
NEXTAUTH_SECRET="your-random-secret-string-here-make-it-long"
NEXTAUTH_URL="http://localhost:3000"
```

### Step 6: Initialize Database

```bash
# Push schema to database
npx prisma db push

# Generate Prisma client
npx prisma generate

# (Optional) Open visual database browser
npx prisma studio
```

### Step 7: Connect to GitHub

```bash
git add .
git commit -m "Initial commit with Policy Hub starter"
git remote add origin https://github.com/YOUR_USERNAME/kubernetes-policy-hub.git
git branch -M main
git push -u origin main
```

### Step 8: Start Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Using Cursor (Your AI-Powered IDE)

### Opening Your Project

1. Open Cursor
2. File → Open Folder
3. Select your `kubernetes-policy-hub` folder
4. You'll see the project files on the left sidebar

### Cursor AI Features

**Chat (Cmd+L / Ctrl+L)**
Ask questions or get help:
```
"Explain what the prisma schema does"
"How do I add a new page for settings?"
"Help me create a form to add a new cluster"
```

**Composer (Cmd+I / Ctrl+I)**
Make multi-file changes:
```
"Add a new API endpoint to create policies and update the policies page to use it"
"Create a new component called ClusterStatus that shows connection health"
```

**Inline Edit (Cmd+K / Ctrl+K)**
Edit specific code:
1. Select some code
2. Press Cmd+K / Ctrl+K
3. Describe what you want changed

### Example Cursor Prompts to Try

```
"Add a button to the clusters page that opens a modal to add a new cluster"

"Create an API route that generates Cilium NetworkPolicy YAML from a description"

"Add a chart to the dashboard showing policy deployment status over time"

"Create a form component for the policy editor with fields for name, type, and YAML content"
```

---

## Using Claude Code (Terminal Agent)

Claude Code is best for complex, multi-step tasks.

### Starting Claude Code

```bash
# Make sure you're in your project directory
cd ~/Projects/kubernetes-policy-hub

# Start Claude Code
claude
```

### Example Claude Code Prompts

```
Create a complete CRUD API for managing clusters. Include:
- GET /api/clusters - list all clusters
- POST /api/clusters - create cluster
- GET /api/clusters/[id] - get single cluster  
- PUT /api/clusters/[id] - update cluster
- DELETE /api/clusters/[id] - delete cluster
Also create the tRPC router and update the clusters page to use it.
```

```
Build the Intent-to-Policy AI feature:
1. Create a new page at /policies/generate
2. Add a text input for natural language policy description
3. Create an API endpoint that calls Claude to generate Cilium YAML
4. Display the generated YAML with syntax highlighting
5. Add a button to save the policy to the database
```

```
Implement cluster connection testing:
1. Add a 'testConnection' field to the Cluster model
2. Create an API endpoint that validates cluster credentials
3. Add a "Test Connection" button to each cluster card
4. Show success/failure status with appropriate styling
```

---

## Database Schema Overview

The included Prisma schema defines:

- **Organization** - Multi-tenant support
- **User** - Users with roles (ADMIN, OPERATOR, VIEWER)
- **Cluster** - Kubernetes clusters with connection info
- **Policy** - Policies with type (CILIUM, TETRAGON, GATEWAY_API)
- **PolicyVersion** - Version history for policies
- **FlowRecord** - Traffic data for simulation
- **Simulation** - Time-travel simulation runs

See `prisma/schema.prisma` for full details.

---

## Project Structure Explained

```
src/
├── app/                    # Pages (URL routes)
│   ├── layout.tsx          # Wraps all pages (nav, theme)
│   ├── page.tsx            # "/" - redirects to dashboard
│   ├── dashboard/page.tsx  # "/dashboard" - main view
│   ├── clusters/page.tsx   # "/clusters" - manage clusters
│   ├── policies/page.tsx   # "/policies" - policy editor
│   └── simulation/page.tsx # "/simulation" - traffic replay
│
├── components/             # Reusable UI pieces
│   ├── ui/                 # Base components (button, card, input)
│   ├── layout/             # App structure (sidebar, nav)
│   └── dashboard/          # Dashboard-specific widgets
│
├── lib/                    # Shared code
│   ├── db.ts               # Database connection
│   └── utils.ts            # Helper functions
│
└── styles/
    └── globals.css         # Theme colors, base styles
```

---

## Design System

Colors (matching your pitch deck):

| Variable | Hex | Usage |
|----------|-----|-------|
| `--background` | #0A0E14 | Page background |
| `--card` | #151B24 | Card backgrounds |
| `--card-hover` | #1C2432 | Card hover state |
| `--primary` | #00D4AA | Primary actions, success |
| `--accent` | #6366F1 | Secondary accent (purple) |
| `--warning` | #F59E0B | Warnings (orange) |
| `--danger` | #EF4444 | Errors, destructive |
| `--muted` | #8B949E | Secondary text |
| `--foreground` | #F0F6FC | Primary text |

---

## Common Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Update database schema
npx prisma db push

# Open database GUI
npx prisma studio

# Run type checking
npm run typecheck

# Format code
npm run format

# Push to GitHub
git add .
git commit -m "Your message"
git push
```

---

## Next Steps

After setup, try these tasks to build out the product:

### Week 1: Core CRUD
1. [ ] Add cluster creation form
2. [ ] List clusters with status indicators
3. [ ] Add policy creation with YAML editor
4. [ ] Implement policy version history

### Week 2: AI Features
1. [ ] Integrate Claude API for policy generation
2. [ ] Add natural language input on policies page
3. [ ] Generate Cilium, Tetragon, Gateway API YAML
4. [ ] Preview and edit generated policies

### Week 3: Simulation
1. [ ] Create simulation run UI
2. [ ] Display flow records visualization
3. [ ] Show policy impact analysis
4. [ ] Add before/after comparison

---

## Getting Help

- **Cursor Issues**: Press Cmd+Shift+P → "Reload Window"
- **Database Issues**: Run `npx prisma db push` again
- **Type Errors**: Run `npm run typecheck` to see details
- **Stuck on a feature**: Ask Cursor AI or Claude Code for help

Happy building! 🚀
