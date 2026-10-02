# Flag service

This canon is a tiny feature-flag Worker. Claim a surface before you edit it.

- `src/index.ts` owns the routes.
- `src/flags.ts` owns defaults and writes.
- `src/auth.ts` owns token checks.
- Leave a note in `.locus/context/` that says why you changed the file.

If Locus reports your surface as contended, keep working in your fork. Do not push onto another agent's remote. The canon lands one winner.
