# bb-plugin-centered-home

Centers the new-thread homepage composer vertically and prepends a centered,
time-based greeting above it:

```
Good afternoon
Monday, September 7
[ composer ]
```

The host renders the compose surface top-aligned (`pt-14`) with empty space
below it. This plugin vertically centers the `max-w-[760px]` stack with a
margin-auto trick — short content sits in the middle, tall content still
scrolls normally — and injects the greeting as the first child of that stack
so it stays directly above the composer, with plugin homepage sections below.

On compact viewports the composer is docked at the bottom, so only the
greeting is added to the scroll content. The no-projects empty state (bb logo
+ buttons) is already centered and just gets the greeting above it.

Selectors (`root-compose-prompt`, the `max-w-[760px]` inner stack, the
`overflow-y-auto` scroll region, `root-compose-compact-scroll-viewport`, and
the empty-state `role="img"` bb logo) were verified against the bb 0.41 app
bundle. Everything is restored on disable/unload.

Install: `bb plugin install /Users/elianiva/Development/personal/bb-plugins/bb-plugin-centered-home`
