# Business Growth Dashboard

A live dashboard for tracking multiple businesses — activities, growth monitoring, and credit tracking.

## Features

- **Business folders** — each business gets its own collapsible folder on the board
- **Task checklists** — every business starts with the core tasks:
  - EIN Number
  - DUNS Number
  - Net 30 Accounts Opened
  - Other Accounts

  Completed tasks get a green check ✓. You can add or remove custom tasks per business.
- **Credit tracking** — record each business's credit score with a color-coded progress bar
- **Growth monitoring** — track monthly revenue and see growth indicators (▲/▼) as it changes
- **Activity monitor** — a live feed of every action taken on the board
- **Live board** — state is saved in the browser (localStorage) and syncs instantly across open tabs

## Usage

Open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server
```

Then click **+ Add Business** to create your first business folder.