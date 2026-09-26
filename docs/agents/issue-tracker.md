# Issue tracker: Local Markdown

Issues and specs live as markdown files in `.scratch/`.

- One directory per feature: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Record state in a `Status:` line near the top of each ticket.
- Append discussion under `## Comments`.

To publish work, create a file at the appropriate path. To fetch a ticket, read its referenced file.

For wayfinding, use `.scratch/<effort>/map.md` as the map and numbered files in `issues/` as child tickets. Each child has a `Type:` (`research`, `prototype`, `grilling`, or `task`) and `Status:` (`claimed` or `resolved`). `Blocked by: NN, NN` lists dependencies. Claim an open, unblocked ticket by setting its status before work; resolve it by adding `## Answer`, setting `Status: resolved`, and linking the answer from the map.
