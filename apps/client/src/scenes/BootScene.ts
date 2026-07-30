/**
 * The only scene in M0. It renders the title, the client build status, and the
 * live server connection status, then opens the connection. There is no
 * gameplay: this scene exists to prove the client boots and reflects the
 * authoritative server's state.
 */
import Phaser from "phaser";

import { type ClientEnv, loadClientEnv } from "../config/env";
import { type ConnectionStatus, connectToFoundationRoom } from "../network/connection";
import { checkServerHealth } from "../network/health";

const COLOR = {
  title: "#e6edf3",
  ok: "#3fb950",
  pending: "#d29922",
  error: "#f85149",
  muted: "#8b949e",
} as const;

const BASE_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Server: connecting…",
  connected: "Server: connected",
  failed: "Server: connection failed",
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: COLOR.pending,
  connected: COLOR.ok,
  failed: COLOR.error,
};

export class BootScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private playersText!: Phaser.GameObjects.Text;
  private healthText!: Phaser.GameObjects.Text;

  constructor() {
    super("boot");
  }

  create(): void {
    const camera = this.cameras.main;
    const centerX = camera.centerX;

    this.add
      .text(centerX, camera.height * 0.3, "Carry or Fall", {
        fontFamily: BASE_FONT,
        fontSize: "48px",
        color: COLOR.title,
      })
      .setOrigin(0.5);

    const env = loadClientEnv();

    this.add
      .text(centerX, camera.height * 0.45, `Client build ${env.buildVersion} — ready`, {
        fontFamily: BASE_FONT,
        fontSize: "18px",
        color: COLOR.ok,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(centerX, camera.height * 0.55, STATUS_LABEL.connecting, {
        fontFamily: BASE_FONT,
        fontSize: "18px",
        color: COLOR.pending,
      })
      .setOrigin(0.5);

    this.playersText = this.add
      .text(centerX, camera.height * 0.63, "", {
        fontFamily: BASE_FONT,
        fontSize: "16px",
        color: COLOR.muted,
      })
      .setOrigin(0.5);

    this.healthText = this.add
      .text(centerX, camera.height * 0.71, "Health: checking…", {
        fontFamily: BASE_FONT,
        fontSize: "16px",
        color: COLOR.pending,
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, camera.height * 0.92, env.serverUrl, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: COLOR.muted,
      })
      .setOrigin(0.5);

    void this.openConnection(env);
    // The HTTP health probe is independent of the WebSocket connection, so it is
    // reported separately: it proves the client can reach the server over HTTP
    // even if the room join is still in flight or fails.
    void this.reportHealth(env);
  }

  private async openConnection(env: ClientEnv): Promise<void> {
    try {
      await connectToFoundationRoom(env, {
        onStatusChange: (status, detail) => this.renderStatus(status, detail),
        onStateChange: (state) => {
          this.playersText.setText(
            `Connected players: ${String(state.connectedPlayers)} · server build ${state.serverBuildVersion}`,
          );
        },
      });
    } catch {
      // The failure was already surfaced via onStatusChange("failed", …).
    }
  }

  private renderStatus(status: ConnectionStatus, detail?: string): void {
    const suffix = status === "failed" && detail !== undefined ? ` (${detail})` : "";
    this.statusText.setText(`${STATUS_LABEL[status]}${suffix}`);
    this.statusText.setColor(STATUS_COLOR[status]);
  }

  private async reportHealth(env: ClientEnv): Promise<void> {
    const result = await checkServerHealth(env.serverUrl);
    if (result.reachable) {
      this.healthText.setText(`Health: ok · server build ${result.health.buildVersion}`);
      this.healthText.setColor(COLOR.ok);
    } else {
      this.healthText.setText(`Health: unreachable (${result.detail})`);
      this.healthText.setColor(COLOR.error);
    }
  }
}
