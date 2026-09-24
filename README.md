# Umami Calendar

A quiet calendar view for the Obsidian sidebar. It doesn't create notes. It just shows the date.

- **Month view:** months scroll continuously and load more as you go. Today is highlighted, Thursdays (release days) get a small dot, and days from the neighboring months are faded in. Clicking a day copies it ("September 18th, 2026"). After 20 seconds idle on another month, it drifts back to today.
- **Year of dots:** one dot per day of the year, bright for past days and pink for today. Hovering a dot bumps it up. The play button starts slow, random ripples you can leave running in the background.
- **Counter:** a floating pill shows the week number, the day of the year and the days left (`W39 · D267 · 98D → 2027`). Hovering a day adds how far it is from today.
- **Layout:** it fills its pane. Square panes get day circles and tall panes get week bands. The dot grid refits when you resize.

## Install

Copy `manifest.json`, `main.js` and `styles.css` into `<vault>/.obsidian/plugins/umami-calendar/`, then enable **Umami Calendar** under Settings → Community plugins.

## Theming

It uses Obsidian's theme variables. Set `--umami-ink` in a CSS snippet to color the month header and month labels. Otherwise it falls back to `--text-normal`.
