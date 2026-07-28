#!/usr/bin/env bash
# Pulls the current research assistants' headshots off rit.edu into this folder,
# so the site stops depending on RIT's server. Run from the repo root:
#   bash assets/people/fetch-headshots.sh
# Re-run only when the roster changes.
set -euo pipefail
cd "$(dirname "$0")"
S="https://www.rit.edu/brainlab/sites/rit.edu.brainlab/files/styles/student_headshot/public/images/students"

get () { curl -fsSL "$2" -o "$1" && echo "  ok  $1" || echo "  MISS $1  <- add manually"; }

get hagar-hendy.jpg     "$S/hagar.jpg?h=a7280831&itok=NkW01mXY"
get justin-sostre.jpg   "$S/justinsostre.jpg?h=bb720d1a&itok=Fz-L2q7K"

# Former members. The alumni list is names and thesis titles only — no photos —
# so these are deliberately not fetched. Kept here rather than deleted so the
# URLs are recoverable if anyone ever wants the images back. Note the RIT tokens
# below expire, and RIT will eventually remove these files outright.
#
# get will-bottom.jpg        "$S/willimg.jpg?itok=Zbe-juoA"
# get manali-dangarikar.jpg  "$S/manalid.jpg?itok=UY45M3Vl"
# get sanskar-gurappa.png    "$S/sanskarg.png?itok=RmfSE3xy"   # genuinely a PNG
# get maya-kaul.jpg          "$S/mayak.jpg?itok=91DmibcG"
# get ujval-madhu.jpg        "$S/ujvalmadhujpg.jpeg?itok=kaewowhs"
# get pranav-natekar.jpg     "$S/pranavnatekar.jpg?itok=_VBz8egR"
# get andrew-tevebaugh.jpg   "$S/andrewt.jpg?itok=IsCmKWDK"
# get diana-velychko.jpg     "$S/dianav0.jpg?itok=kalBMUA1"

echo
echo "cory-merkel.jpg is not fetched automatically -- the RIT directory URL carries"
echo "an expiring token. It is already committed; leave it alone."
