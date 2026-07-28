#!/usr/bin/env bash
# Pulls the current headshots off rit.edu into this folder, once, so the site
# stops depending on RIT's server. Run from the repo root:  bash assets/people/fetch-headshots.sh
# Re-run only when the roster changes.
set -euo pipefail
cd "$(dirname "$0")"
S="https://www.rit.edu/brainlab/sites/rit.edu.brainlab/files/styles/student_headshot/public/images/students"

get () { curl -fsSL "$2" -o "$1" && echo "  ok  $1" || echo "  MISS $1  <- add manually"; }

get will-bottom.jpg        "$S/willimg.jpg?itok=Zbe-juoA"
get manali-dangarikar.jpg  "$S/manalid.jpg?itok=UY45M3Vl"
get sanskar-gurappa.png    "$S/sanskarg.png?itok=RmfSE3xy"   # genuinely a PNG, not a JPEG
get hagar-hendy.jpg        "$S/hagar.jpg?h=a7280831&itok=NkW01mXY"
get maya-kaul.jpg          "$S/mayak.jpg?itok=91DmibcG"
get ujval-madhu.jpg        "$S/ujvalmadhujpg.jpeg?itok=kaewowhs"
get pranav-natekar.jpg     "$S/pranavnatekar.jpg?itok=_VBz8egR"
get justin-sostre.jpg      "$S/justinsostre.jpg?h=bb720d1a&itok=Fz-L2q7K"
get andrew-tevebaugh.jpg   "$S/andrewt.jpg?itok=IsCmKWDK"
get diana-velychko.jpg     "$S/dianav0.jpg?itok=kalBMUA1"

echo
echo "cory-merkel.jpg is not fetched automatically -- the RIT directory URL carries"
echo "an expiring token. Save your headshot here manually as cory-merkel.jpg."
