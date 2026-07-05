import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { Chess, type Square } from "chess.js";
import { pieceSvg } from "./pieces";

/**
 * Bridge.SmokeTestPanel — a full-page dataset PCF that lets a human (White) play chess against M365
 * Copilot (Black) over the bi-directional Xrm.Copilot ↔ MCP bridge. The dataset only hosts the control
 * full-page; records are ignored. (Class name kept as SmokeTestPanel so the existing grid binding still
 * resolves — see the CopilotPcfChess spec §8.)
 *
 *   Human move   :  click a piece → click a legal target. The move is POSTed to the server (source of
 *                   truth), then a "your move" prompt is auto-submitted to the Copilot pane.
 *   Copilot move :  the agent's chess_make_move tool nudges the board here; we reconcile via GET /game.
 *   Board state  :  the server owns it (chess.js). A local chess.js mirror only drives highlighting +
 *                   optimistic feedback; the server always re-validates.
 *
 * Nudge envelope — MUST match the server viewer (mcp-server/src/mcp-app.ts):
 *   { eventName: "powerapps.copilot.chat.action", action: "template.chess.moved",
 *     actionData: { fen, san, from, to, status, result } }
 */

// window.Xrm.Copilot is ambient in a model-driven app but absent from PCF typings.
interface CopilotApi {
  isM365CopilotEnabled?: () => boolean;
  openM365CopilotPanel?: () => Promise<void> | void;
  sendPromptToM365Copilot?: (text: string, options?: { autoSubmit?: boolean; gptId?: string }) => Promise<void> | void;
  addActionHandler?: (action: string, handler: (data: unknown) => void) => void;
}
function copilotApi(): CopilotApi | undefined {
  return (window as unknown as { Xrm?: { Copilot?: CopilotApi } }).Xrm?.Copilot;
}

const HOST_EVENT = "powerapps.copilot.chat.action";
const HOST_ACTION = "template.chess.moved";
const FILES = "abcdefgh";

interface GameSnapshot {
  fen: string;
  history: string[];
  humanColor: "w" | "b";
  turn: "w" | "b";
  status: "active" | "check" | "checkmate" | "stalemate" | "draw";
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  lastMove: { san: string; from: string; to: string } | null;
  updatedAt: string;
}

export class SmokeTestPanel implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private root!: HTMLDivElement;
  private gptInput!: HTMLInputElement;
  private statusEl!: HTMLDivElement;
  private infoEl!: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private capturedEl!: HTMLDivElement;
  private squares: Record<string, HTMLDivElement> = {};

  private serverBaseUrl = "";
  private agentId = "";
  private stateKey = "";
  private pollSeconds = 0;
  private pollHandle: number | undefined;

  // Local mirror of the server position — drives highlighting + optimistic apply only.
  private chess = new Chess();
  private game: GameSnapshot | null = null;
  private selected: string | null = null;
  private busy = false; // a human move is in flight (board locked)

  private onWindowMessage = (e: MessageEvent): void => this.handleHostMessage(e);

  public init(
    context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement,
  ): void {
    this.readConfig(context);
    this.buildChrome(container);

    // Nudge receive — DUAL registration (the Copilot pane is a nested iframe; addActionHandler routing
    // can be unreliable there, so the raw message listener is the load-bearing path).
    copilotApi()?.addActionHandler?.(HOST_ACTION, () => void this.fetchGame(true));
    window.addEventListener("message", this.onWindowMessage);

    void this.fetchGame(false);
    this.applyPolling();
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const before = `${this.serverBaseUrl}|${this.stateKey}|${this.pollSeconds}|${this.agentId}`;
    this.readConfig(context);
    if (`${this.serverBaseUrl}|${this.stateKey}|${this.pollSeconds}|${this.agentId}` !== before) {
      if (this.gptInput && !this.gptInput.value) this.gptInput.value = this.agentId;
      this.applyPolling();
    }
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    window.removeEventListener("message", this.onWindowMessage);
    if (this.pollHandle !== undefined) window.clearInterval(this.pollHandle);
  }

  // --- config ---------------------------------------------------------------
  private readConfig(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    this.serverBaseUrl = (p.serverBaseUrl.raw ?? "").replace(/\/+$/, "");
    this.agentId = p.agentId.raw ?? "";
    this.stateKey = p.stateKey.raw ?? "";
    this.pollSeconds = Math.max(0, p.autoRefreshSeconds.raw ?? 0);
  }

  private applyPolling(): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
    if (this.pollSeconds > 0 && this.serverBaseUrl && this.stateKey) {
      this.pollHandle = window.setInterval(() => void this.fetchGame(true), this.pollSeconds * 1000);
    }
  }

  // --- DOM ------------------------------------------------------------------
  private buildChrome(container: HTMLDivElement): void {
    this.root = document.createElement("div");
    this.root.className = "bsp-root";

    const title = document.createElement("div");
    title.className = "bsp-title";
    title.textContent = "♟ Play chess with Copilot";

    const sub = document.createElement("div");
    sub.className = "bsp-sub";
    sub.textContent = "You are White. Move a piece and Copilot (Black) replies through the MCP bridge.";

    // action buttons
    const actions = document.createElement("div");
    actions.className = "bsp-row";
    const newBtn = document.createElement("button");
    newBtn.className = "bsp-btn bsp-btn--primary";
    newBtn.textContent = "New game";
    newBtn.addEventListener("click", () => void this.newGame());
    const hintBtn = document.createElement("button");
    hintBtn.className = "bsp-btn";
    hintBtn.textContent = "Ask Copilot for a hint";
    hintBtn.addEventListener("click", () => void this.askHint());
    actions.append(newBtn, hintBtn);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "bsp-status";

    // board + captured-pieces panel, laid out side by side (panel wraps below on narrow widths).
    const playWrap = document.createElement("div");
    playWrap.className = "bsp-play";
    this.boardEl = document.createElement("div");
    this.boardEl.className = "bsp-board";
    this.buildBoard();
    this.capturedEl = document.createElement("div");
    this.capturedEl.className = "bsp-captured";
    playWrap.append(this.boardEl, this.capturedEl);

    this.infoEl = document.createElement("div");
    this.infoEl.className = "bsp-info";

    // Agent settings — collapsed by default so the gptId can be set once and tucked away.
    const settings = document.createElement("details");
    settings.className = "bsp-settings";
    const summary = document.createElement("summary");
    summary.textContent = "⚙ Agent settings";
    const label = document.createElement("label");
    label.className = "bsp-label";
    label.textContent = "Declarative agent gptId";
    this.gptInput = document.createElement("input");
    this.gptInput.className = "bsp-input";
    this.gptInput.placeholder = "gptId (T_<guid>)";
    this.gptInput.value = this.agentId;
    label.appendChild(this.gptInput);
    settings.append(summary, label);

    this.root.append(title, sub, actions, this.statusEl, playWrap, this.infoEl, settings);
    container.appendChild(this.root);
    this.renderCaptured();
  }

  private buildBoard(): void {
    this.boardEl.innerHTML = "";
    this.squares = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const name = FILES[c] + (8 - r);
        const sq = document.createElement("div");
        sq.className = "bsp-sq " + ((r + c) % 2 === 0 ? "bsp-sq--light" : "bsp-sq--dark");
        sq.dataset.sq = name;
        // coordinate labels: files along the bottom rank, ranks along the a-file.
        if (r === 7) {
          const f = document.createElement("span");
          f.className = "bsp-coord bsp-coord--file";
          f.textContent = FILES[c];
          sq.appendChild(f);
        }
        if (c === 0) {
          const rk = document.createElement("span");
          rk.className = "bsp-coord bsp-coord--rank";
          rk.textContent = String(8 - r);
          sq.appendChild(rk);
        }
        sq.addEventListener("click", () => this.onSquareClick(name));
        this.boardEl.appendChild(sq);
        this.squares[name] = sq;
      }
    }
  }

  private setStatus(msg: string, kind: "" | "ok" | "err" | "busy" = ""): void {
    this.statusEl.textContent = msg;
    this.statusEl.className = "bsp-status" + (kind ? " bsp-status--" + kind : "");
  }

  // --- rendering ------------------------------------------------------------
  private render(): void {
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const name = FILES[c] + (8 - r);
        const sq = this.squares[name];
        // Remove any existing piece / marker (keep coordinate labels).
        sq.querySelectorAll(".bsp-piece, .bsp-marker").forEach((n) => n.remove());
        sq.classList.remove("bsp-sq--sel", "bsp-sq--last");
        const cell = board[r][c];
        const svg = pieceSvg(cell);
        if (svg) {
          const piece = document.createElement("div");
          piece.className = "bsp-piece";
          piece.innerHTML = svg;
          sq.appendChild(piece);
        }
      }
    }
    // Highlight the last move.
    if (this.game?.lastMove) {
      this.squares[this.game.lastMove.from]?.classList.add("bsp-sq--last");
      this.squares[this.game.lastMove.to]?.classList.add("bsp-sq--last");
    }
    this.renderSelection();
    this.renderInfo();
  }

  private renderSelection(): void {
    // Clear markers/selection state.
    Object.values(this.squares).forEach((sq) => {
      sq.classList.remove("bsp-sq--sel");
      sq.querySelectorAll(".bsp-marker").forEach((n) => n.remove());
    });
    if (!this.selected) return;
    this.squares[this.selected]?.classList.add("bsp-sq--sel");
    for (const mv of this.chess.moves({ square: this.selected as Square, verbose: true })) {
      const marker = document.createElement("div");
      const isCapture = mv.flags.includes("c") || mv.flags.includes("e");
      marker.className = "bsp-marker" + (isCapture ? " bsp-marker--cap" : "");
      this.squares[mv.to]?.appendChild(marker);
    }
  }

  private renderInfo(): void {
    if (!this.game) {
      this.infoEl.textContent = "";
      return;
    }
    const g = this.game;
    let line: string;
    if (g.status === "checkmate") line = `Checkmate — ${g.result === "1-0" ? "you win! 🎉" : "Copilot wins."}`;
    else if (g.status === "stalemate") line = "Stalemate — draw.";
    else if (g.status === "draw") line = "Draw.";
    else if (g.turn === g.humanColor) line = g.status === "check" ? "Check! Your move." : "Your move.";
    else line = g.status === "check" ? "Check! Copilot is thinking…" : "Copilot is thinking…";
    const last = g.lastMove ? `  ·  last: ${g.lastMove.san}` : "";
    this.infoEl.textContent = line + last;
  }

  private isHumanTurn(): boolean {
    return !!this.game && this.game.turn === this.game.humanColor && !this.isGameOver();
  }
  private isGameOver(): boolean {
    return !!this.game && (this.game.status === "checkmate" || this.game.status === "stalemate" || this.game.status === "draw");
  }

  // --- interaction (human = White) ------------------------------------------
  private onSquareClick(name: string): void {
    if (this.busy || !this.isHumanTurn()) return;
    const piece = this.chess.get(name as Square);

    if (this.selected && name !== this.selected) {
      const legal = this.chess
        .moves({ square: this.selected as Square, verbose: true })
        .some((m) => m.to === name);
      if (legal) {
        void this.playHumanMove(this.selected, name);
        return;
      }
    }
    // (Re)select own piece, or deselect.
    if (piece && piece.color === this.game!.humanColor) {
      this.selected = this.selected === name ? null : name;
    } else {
      this.selected = null;
    }
    this.renderSelection();
  }

  private async playHumanMove(from: string, to: string): Promise<void> {
    const prevFen = this.game?.fen ?? this.chess.fen();

    // Optimistic local apply for instant feedback, then lock the board. Auto-queen: passing
    // promotion:"q" is ignored on non-promotion moves and promotes to a queen on the last rank (v1).
    try {
      this.chess.move({ from, to, promotion: "q" });
    } catch {
      this.selected = null;
      this.renderSelection();
      return;
    }
    this.selected = null;
    this.busy = true;
    this.render();
    this.setStatus("Sending your move…", "busy");

    const san = this.chess.history().slice(-1)[0] ?? "";
    try {
      const res = await fetch(`${this.serverBaseUrl}/move?k=${encodeURIComponent(this.stateKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        throw new Error(body.reason ? `move rejected (${body.reason})` : `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { game: GameSnapshot };
      this.applyGame(body.game);
      this.busy = false;
      void this.handoffToCopilot(san);
    } catch (err) {
      // Roll back on ANY failure (409 or network) — the server never saw / rejected the move.
      this.busy = false;
      this.chess = new Chess(prevFen);
      this.render();
      this.setStatus("Move failed: " + this.msg(err) + " — try again.", "err");
    }
  }

  private async handoffToCopilot(san: string): Promise<void> {
    const copilot = copilotApi();
    const gptId = this.gptInput.value.trim() || this.agentId;
    if (!copilot?.sendPromptToM365Copilot || !copilot.openM365CopilotPanel) {
      this.setStatus("Move saved. Open this inside the model-driven app so Copilot can reply.", "err");
      return;
    }
    if (!gptId) {
      this.setStatus("Move saved, but no agent set — open Agent settings and fill the gptId so Copilot can reply.", "err");
      return;
    }
    this.setStatus("Your move is in. Asking Copilot to reply…", "busy");
    try {
      await copilot.openM365CopilotPanel();
      await copilot.sendPromptToM365Copilot(`I played ${san}. Your move.`, { autoSubmit: true, gptId });
      this.setStatus("Waiting for Copilot to move…", "busy");
    } catch (err) {
      // The move is already committed server-side — do NOT roll back.
      this.setStatus("Move saved, but couldn't open Copilot (" + this.msg(err) + "). Open the pane and say 'your move'.", "err");
    }
  }

  private async askHint(): Promise<void> {
    const copilot = copilotApi();
    const gptId = this.gptInput.value.trim() || this.agentId;
    if (!copilot?.sendPromptToM365Copilot || !copilot.openM365CopilotPanel) {
      this.setStatus("Open this inside the model-driven app to ask Copilot (window.Xrm.Copilot absent).", "err");
      return;
    }
    if (!gptId) {
      this.setStatus("No agent set — open Agent settings and fill the gptId first.", "err");
      return;
    }
    try {
      await copilot.openM365CopilotPanel();
      await copilot.sendPromptToM365Copilot("Suggest a good move for me (White) — explain it, but don't play it.", { autoSubmit: true, gptId });
      this.setStatus("Asked Copilot for a hint.", "ok");
    } catch (err) {
      this.setStatus("Could not ask for a hint: " + this.msg(err), "err");
    }
  }

  /**
   * Render the captured-piece panel from the authoritative SAN history. The local `this.chess`
   * mirror is reset to the bare FEN on every applyGame (losing history), so replay the server's
   * `game.history` through a throwaway board and collect each verbose move's `captured` type,
   * crediting the side that did the capturing. Robust to en-passant and promotions (chess.js sets
   * `captured` on the move object in both cases).
   */
  private renderCaptured(): void {
    if (!this.capturedEl) return;
    const taken: Record<"w" | "b", string[]> = { w: [], b: [] };
    if (this.game) {
      const replay = new Chess();
      for (const san of this.game.history) {
        const mv = replay.move(san); // history is server-validated; v1 throws only on genuinely bad SAN
        if (mv.captured) taken[mv.color === "w" ? "b" : "w"].push(mv.captured);
      }
    }
    // Group top→bottom to mirror the board (Black at top): pieces Black took, then pieces White took.
    this.capturedEl.innerHTML = "";
    this.capturedEl.append(
      this.buildCapGroup("Copilot captured", "b", taken.w),
      this.buildCapGroup("You captured", "w", taken.b),
    );
  }

  /** One captured-pieces group: label + a row of small SVG icons of `color`, ordered by value. */
  private buildCapGroup(label: string, color: "w" | "b", types: string[]): HTMLDivElement {
    const VALUE: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
    const group = document.createElement("div");
    group.className = "bsp-cap-group";
    const head = document.createElement("div");
    head.className = "bsp-cap-label";
    head.textContent = label;
    const pts = types.reduce((s, t) => s + (VALUE[t] ?? 0), 0);
    if (pts > 0) {
      const badge = document.createElement("span");
      badge.className = "bsp-cap-pts";
      badge.textContent = "+" + pts;
      head.appendChild(badge);
    }
    const icons = document.createElement("div");
    icons.className = "bsp-cap-icons";
    for (const t of [...types].sort((a, b) => (VALUE[b] ?? 0) - (VALUE[a] ?? 0))) {
      const cell = document.createElement("div");
      cell.className = "bsp-cap-piece";
      cell.innerHTML = pieceSvg({ color, type: t });
      icons.appendChild(cell);
    }
    group.append(head, icons);
    return group;
  }

  // --- server sync ----------------------------------------------------------
  private async newGame(): Promise<void> {
    if (!this.serverBaseUrl || !this.stateKey) {
      this.setStatus("Set Server Base URL and State Key on the control.", "err");
      return;
    }
    this.setStatus("Starting a new game…", "busy");
    try {
      const res = await fetch(`${this.serverBaseUrl}/new-game?k=${encodeURIComponent(this.stateKey)}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { game: GameSnapshot };
      this.applyGame(body.game);
      this.setStatus("New game — you are White. Make your move.", "ok");
    } catch (err) {
      this.setStatus("Could not start a new game: " + this.msg(err), "err");
    }
  }

  private async fetchGame(quiet: boolean): Promise<void> {
    if (!this.serverBaseUrl || !this.stateKey) {
      if (!quiet) this.setStatus("Set Server Base URL and State Key on the control.", "err");
      return;
    }
    try {
      const res = await fetch(`${this.serverBaseUrl}/game?k=${encodeURIComponent(this.stateKey)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { game: GameSnapshot };
      // Change-detected: only repaint when the position actually moved (don't wipe a mid-click select).
      const prev = this.game;
      if (!this.busy && (!prev || prev.fen !== body.game.fen || prev.updatedAt !== body.game.updatedAt)) {
        const cameFromCopilot = !!prev && prev.turn !== prev.humanColor; // it was Black (Copilot) to move
        this.applyGame(body.game);
        // Always clear any lingering "Waiting for Copilot…" spinner once the board actually changes.
        if (this.isGameOver()) this.setStatus(this.infoEl.textContent || "Game over.", "ok");
        else if (cameFromCopilot && this.isHumanTurn()) this.setStatus("Copilot moved — your turn.", "ok");
        else if (!quiet) this.setStatus("Board updated.", "ok");
        else this.setStatus("");
      }
    } catch (err) {
      if (!quiet) this.setStatus("Could not read the board: " + this.msg(err), "err");
    }
  }

  /** Adopt a server snapshot as the source of truth and repaint. */
  private applyGame(game: GameSnapshot): void {
    this.game = game;
    this.selected = null;
    this.chess = new Chess(game.fen);
    this.render();
    this.renderCaptured();
    if (game.status === "checkmate" || game.status === "stalemate" || game.status === "draw") {
      this.renderInfo();
    }
  }

  // --- Copilot → PCF (nudge) ------------------------------------------------
  private handleHostMessage(e: MessageEvent): void {
    const d = e.data as { eventName?: string; action?: string } | null;
    if (!d || d.eventName !== HOST_EVENT || d.action !== HOST_ACTION) return;
    // Reconcile-via-server: the nudge is only a wake signal; the authoritative board is GET /game.
    void this.fetchGame(true);
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
