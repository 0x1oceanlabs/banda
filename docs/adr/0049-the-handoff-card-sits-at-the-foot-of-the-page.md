---
status: accepted
date: 2026-11-04
---

# The handoff card sits at the foot of the page

## Context

The real browser trial (issue #474) showed the window's top-right toast
covering the handoff card, including its Done button. ADR 0029 decision 6
puts that card at the top of the page; ADR 0011 keeps toasts at the top
right of the window.

## Decision

The handoff card sits across the foot of the page, in the browser's own
overlay, as its other waits do. Its text describes every handoff: the
Thread waits until the Person hands back the tab. Password handling stays
in the tools' descriptions and their field guards.

This replaces the handoff card's top placement in ADR 0029 decision 6.
Toasts keep their position.
