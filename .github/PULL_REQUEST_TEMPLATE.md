## Summary

<!-- 1–3 sentences: what changed and why. Link the problem this solves. -->

## Linked issue

<!-- Closes #NNN. If there's no issue, paste the user-visible problem here. -->

## Type of change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 🔧 Refactor / internal cleanup
- [ ] 📝 Docs
- [ ] 🚀 Build / CI / release

## Screenshots / GIFs

<!-- Required for any UI-visible change. Drag images here. -->

## Checklist

- [ ] `npm run check` passes (typecheck + build)
- [ ] User-visible strings updated in `src/renderer/src/i18n.ts` (both `zh` and `en` keys)
- [ ] No new dependencies, OR the new dependency is justified in the summary above
- [ ] If the schema changed: a migration was added in `src/main/db.ts` and tested against a non-empty DB
- [ ] If a new analyst persona was added: corresponding entry in `src/renderer/src/presets.ts` with bilingual prompt
