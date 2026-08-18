# Composer draft scrolling (14-line cap, two text layers, one scrollport)

## At the start of the draft

- draft overflows the capped box: true
- visible lines: 14
- the textarea holds no scroll offset of its own: true
- all three layers wrap at one width: true
- scroll offset: 0px
- caret and glyphs stay level when the offset changes: true
- first draft line is on screen: true
- last draft line is on screen: false

## Scrolled to the end of the draft

- offset moved: true
- caret sits on its own glyphs: true
- caret and glyphs stay level when the offset changes: true
- first draft line has scrolled out above: true
- last draft line is on screen: true

## Draft ending in a newline, scrolled to the end

- caret sits on its own glyphs: true
- the draft's own last line is on screen: true

## Right after pasting a long block at the end

- the composer scrolled to the caret it left: true
- caret and glyphs stay level when the offset changes: true
- the pasted block's last line is on screen: true
