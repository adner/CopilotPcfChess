# Third-party notices

This project redistributes the third-party components below. Each is used under the license quoted
here. This file satisfies the notice-retention requirements of those licenses for both the source in
this repository and the binaries built from it (the PCF control bundle and the MCP viewer HTML, both of
which embed `chess.js`; the chess piece SVGs are embedded as source in
`pcf-control/SmokeTestPanel/pieces.ts` and `mcp-server/src/chess-pieces.ts`).

---

## chess.js

- **Project:** chess.js — https://github.com/jhlywa/chess.js
- **Version:** 1.4.0
- **Author:** Jeff Hlywa
- **License:** BSD 2-Clause "Simplified" License
- **How it is used here:** declared as an npm dependency in `mcp-server/` and `pcf-control/`, and
  bundled into the shipped PCF control bundle and the MCP viewer (`dist/mcp-app.html`).

```
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

---

## Cburnett chess piece set (SVG artwork)

- **Author:** Colin M.L. Burnett
- **Source:** the "cburnett" set from lichess-org/lila
  (https://github.com/lichess-org/lila/tree/master/public/piece/cburnett), originally published on
  Wikimedia Commons (https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces).
- **Original licensing:** the author multi-licensed these images under a choice of **GNU FDL 1.2+**,
  **CC BY-SA 3.0**, **BSD 3-Clause**, and **GPL v2+**. The licensee may select any one.
- **License selected for this project:** **BSD 3-Clause**, quoted below.
- **How it is used here:** the twelve piece SVGs are embedded as string literals in
  `pcf-control/SmokeTestPanel/pieces.ts` and `mcp-server/src/chess-pieces.ts` (kept identical), and
  rendered on the PCF board and in the MCP viewer's board card.

```
Copyright (c) Colin M.L. Burnett

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the author nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```
