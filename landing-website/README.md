# UNDRIFT Website

Official standalone static website and documentation portal for [UNDRIFT](https://github.com/undrift) — the developer tool for detecting API contract drift between frontend API usage and backend API definitions.

## Overview

This is a fast, lightweight, frontend-only static website built with React 18, Vite, TypeScript, and TailwindCSS. It is designed to run independently and to easily integrate into the UNDRIFT monorepo.

### Key Features
- **Brand Introduction**: Full-screen brand intro featuring the official UNDRIFT logo mark.
- **Scroll-Driven Logo Transition**: Smooth vector interpolation moving the brand mark seamlessly from the hero into the minimal navbar on scroll.
- **Interactive Kinetic-Grid Hero**: Vanilla 2D canvas background reacting to cursor warp and click ripples.
- **Static Documentation Portal**: Modular documentation with static markdown/spec content, table of contents, and sidebar navigation.
- **Monochrome Minimal Aesthetic**: Modern black/white palette with Geist typography.
- **Zero Backend**: 100% static frontend with SPA routing fallback for static hosting (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

## Tech Stack

- **Framework**: React 18 + React Router 6 (SPA)
- **Tooling**: Vite + TypeScript
- **Styling**: TailwindCSS + PostCSS
- **Animation**: Framer Motion + Native Canvas API
- **Icons**: Lucide React
- **Package Manager**: pnpm

## Getting Started

```bash
# Install dependencies
pnpm install

# Start local dev server (port 8080)
pnpm dev

# Type check
pnpm typecheck

# Run unit tests
pnpm test

# Build static production bundle (output to dist/)
pnpm build

# Preview production build locally
pnpm preview
```

## Project Structure

```text
landing-website/
├── public/                     # Static assets & brand files
│   ├── favicon.svg             # Official vector favicon
│   ├── undrift-logo.svg        # Official vector logo
│   ├── undrift-logo.png        # Official high-resolution brand image
│   └── _redirects              # Static host SPA redirect rule
├── client/
│   ├── components/
│   │   ├── brand/              # Official LogoMark and Wordmark components
│   │   ├── common/             # Eyebrow, Reveal, SectionLink helpers
│   │   ├── docs/               # Docs layout, header, sidebar, TOC, code blocks
│   │   ├── home/               # Brand intro, kinetic hero, animated logo, navbar, sections
│   │   └── ui/                 # Minimal Button component
│   ├── lib/
│   │   ├── docs.ts             # Static documentation content and topics
│   │   ├── site-config.ts      # External destination URLs
│   │   └── utils.ts            # Class name merging utility (cn)
│   ├── pages/
│   │   ├── docs/               # DocsHome and DocPage views
│   │   ├── Index.tsx           # Home landing page
│   │   └── NotFound.tsx        # 404 fallback page
│   ├── App.tsx                 # Root application & router
│   └── global.css              # Theme tokens & global styles
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

