import { createTransport, type Transporter } from "nodemailer";
import { monitorConfig } from "./config.js";
import type { NotificationChannel } from "./types.js";

export class EmailChannel implements NotificationChannel {
  readonly name = "email";
  recipient: string | null = null;
  private transporter: Transporter | null = null;

  get enabled(): boolean {
    return monitorConfig.email.enabled && Boolean(this.recipient);
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const { host, port, secure, user, pass } = monitorConfig.email;

    this.transporter = createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
    });

    return this.transporter;
  }

  async send(message: string): Promise<void> {
    if (!this.enabled || !this.recipient) {
      console.error("[VaultMonitor] Alert (no email configured):", message.slice(0, 200));
      return;
    }

    const { from } = monitorConfig.email;
    const transport = this.getTransporter();
    await transport.sendMail({
      from,
      to: this.recipient,
      subject: "Lido Vault Monitor Alert",
      html: message,
    });
  }

  async sendTest(): Promise<{ success: boolean; error?: string }> {
    if (!monitorConfig.email.enabled) {
      return { success: false, error: "Email not configured. Set SMTP_HOST in your environment." };
    }
    if (!this.recipient) {
      return { success: false, error: "No email recipient set. Provide an email_to address." };
    }

    try {
      const { from } = monitorConfig.email;
      const transport = this.getTransporter();
      await transport.sendMail({
        from,
        to: this.recipient,
        subject: "Lido Vault Monitor — Test",
        html: "<p>Lido Vault Monitor connected. Alerts will be sent to this address.</p>",
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
