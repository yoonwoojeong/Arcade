## What does this change?

<!-- A short description and the issue it addresses, e.g. "Fixes #123". -->

## How was it tested?

<!-- e.g. `npm test`, `npm run test:e2e`, manual steps. -->

## Checklist

- [ ] `npm test`, `npm run lint` and `npm run format:check` pass
- [ ] Every commit is signed off (`git commit -s`), per the [DCO](https://developercertificate.org/)
- [ ] Docs and `CHANGELOG.md` are updated if behaviour changed

## Accessibility (for any UI or game change)

- [ ] Fully playable with the keyboard alone
- [ ] State changes are announced (`ctx.announce`), or the game declares `screenReader: "none"`
- [ ] No information conveyed by colour alone
- [ ] Reduced motion is honoured
- [ ] Nothing flashes more than 3 times per second

## New game

- [ ] Copied from `templates/game`, `game.json` is valid, and the game README credits any assets
- [ ] No network access, tracking, or violent or adult content

By submitting this pull request I certify the [Developer Certificate of Origin](https://developercertificate.org/):
my commits carry a `Signed-off-by` line.
