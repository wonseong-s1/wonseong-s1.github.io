prime235711.github.io redesign

A minimal academic homepage designed for a mathematician: research-first, typography-heavy, and easy to maintain on GitHub Pages.

Deploy

Copy these into the root of prime235711/prime235711.github.io:

index.html

assets/styles.css

assets/site.js

Keep your existing Solutions/ directory. The current Dummit & Foote PDF path is already wired into the page.

GitHub Pages will serve index.html instead of rendering the repository README.md through the Jekyll Minimal theme.

Add slides

For example, place a PDF at:

Talks/ATMCS12.pdf

Then change the relevant slides label in index.html into:

<a href="/Talks/ATMCS12.pdf" target="_blank" rel="noreferrer">slides ↗</a>

Add more publications / notes

Duplicate an existing .publication, .archive-row, or .resource-card block in index.html and edit the text and links.
