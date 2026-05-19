// Static asset module declarations for TypeScript.
//
// Next.js generates `next-env.d.ts` on `next dev` / `next build` with
// these same `next` / `next/image-types/global` references, but that
// file is gitignored. CI's `pnpm typecheck` step runs `tsc --noEmit`
// without first running `next`, so the generated file is missing and
// `import x from "../public/images/foo.gif"` fails with TS2307. This
// committed shim provides the same declarations so the typecheck job
// is self-sufficient.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
