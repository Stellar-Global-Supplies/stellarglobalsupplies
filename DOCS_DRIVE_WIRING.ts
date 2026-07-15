// ═══════════════════════════════════════════════════════════════
// WIRING GUIDE — paste these snippets into the correct files
// ═══════════════════════════════════════════════════════════════


// ─── 1. frontend/src/types/index.ts ───────────────────────────
// Add to your NavSection union type:

export type NavSection =
  | 'dashboard'
  | 'agents'
  | 'ingest'
  | 'inventory'
  | 'analytics'
  | 'registers'
  | 'meta'
  | 'tasks'
  | 'orders'
  | 'quotations'
  | 'documents';   // ← ADD THIS


// ─── 2. frontend/src/App.tsx ──────────────────────────────────
// Step A — import the component (add near the other imports):

import DocumentsDrive from './components/DocumentsDrive';

// Step B — add to CEO_ITEMS array (pick a position in the sidebar):
// (import HardDrive from 'lucide-react' — add to your existing lucide import)

{
  key: 'documents' as NavSection,
  label: 'Documents',
  icon: HardDrive,        // lucide-react icon
  description: 'File storage & drive',
}

// Step C — add a case in the MainContent switch statement:

case 'documents':
  return <DocumentsDrive />;


// ─── 3. .github/workflows/deploy.yml ─────────────────────────
// Add this build step alongside your other Lambda build steps:

/*
  - name: Build docs-drive Lambda
    run: |
      cd lambda/docs-drive
      npm ci
      npm run build
*/


// ─── 4. Directory structure to create ────────────────────────
/*
lambda/
└── docs-drive/
    ├── src/
    │   └── handler.ts          ← the handler file provided
    ├── package.json            ← the package.json provided
    └── tsconfig.json           ← the tsconfig provided

frontend/src/components/
└── DocumentsDrive.tsx          ← the component provided
*/


// ─── 5. Local dev — environment variable ─────────────────────
// frontend/.env.local already has VITE_API_BASE_URL set.
// No additional env vars needed on the frontend.
// The Lambda reads DOCS_BUCKET and DOCS_TABLE from the environment,
// which Terraform injects automatically.


// ─── 6. Deploy order ─────────────────────────────────────────
/*
  1. Create lambda/docs-drive/ with the provided files
  2. Add docs-drive.tf content to terraform/main.tf
  3. Add build step to deploy.yml
  4. Add DocumentsDrive.tsx to frontend/src/components/
  5. Wire App.tsx (steps A–C above)
  6. git push origin main  →  auto-deploys via GitHub Actions

  Manual one-time run (if not using CI/CD yet):
    cd lambda/docs-drive && npm ci && npm run build
    cd terraform && terraform plan && terraform apply
    cd frontend && npm run build
*/
