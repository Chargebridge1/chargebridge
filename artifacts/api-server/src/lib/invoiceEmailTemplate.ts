interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceEmailData {
  invoiceNumber: string;
  status: string;
  businessName: string;
  businessEmail: string;
  dueDate: string;
  createdAt: string;
  totalAmount: number;
  items: InvoiceItem[];
  notes?: string | null;
}

function fmtCurrency(n: number) {
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function stripReceiptMarker(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes.replace(/\[charging-receipt:session-\d+\]\s*/g, "").trim();
}

const STATUS_COLORS: Record<string, string> = {
  draft:   "#6b7280",
  sent:    "#2563eb",
  paid:    "#059669",
  overdue: "#dc2626",
};

const STATUS_BG: Record<string, string> = {
  draft:   "#f3f4f6",
  sent:    "#eff6ff",
  paid:    "#ecfdf5",
  overdue: "#fef2f2",
};

export function buildInvoiceEmailHtml(inv: InvoiceEmailData, isReceipt = false): string {
  const color = STATUS_COLORS[inv.status] ?? "#059669";
  const bg    = STATUS_BG[inv.status]    ?? "#ecfdf5";
  const notes = stripReceiptMarker(inv.notes);

  const itemRows = inv.items.map((item) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;">${item.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;text-align:right;">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;text-align:right;">${fmtCurrency(item.unitPrice)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#1a1a1a;text-align:right;">${fmtCurrency(item.amount)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isReceipt ? "Charging Receipt" : "Invoice"} ${inv.invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background:#0D9E7E;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="display:inline-flex;align-items:center;gap:8px;">
                      <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">⚡ ChargeBridge</span>
                    </div>
                    <div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:4px;">Independent EV Charging Network</div>
                  </td>
                  <td align="right">
                    <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:8px 14px;display:inline-block;">
                      <div style="color:rgba(255,255,255,0.8);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${isReceipt ? "Charging Receipt" : "Invoice"}</div>
                      <div style="color:#ffffff;font-size:18px;font-weight:700;margin-top:2px;">${inv.invoiceNumber}</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Status + Amount -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="background:${bg};color:${color};font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;text-transform:capitalize;">${inv.status}</span>
                  </td>
                  <td align="right">
                    <div style="font-size:32px;font-weight:800;color:#1a1a1a;">${fmtCurrency(inv.totalAmount)}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">Total ${isReceipt ? "charged" : "due"}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Meta grid -->
          <tr>
            <td style="padding:20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;">
                <tr>
                  <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:50%;padding-bottom:12px;">
                          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">To</div>
                          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${inv.businessName}</div>
                          <div style="font-size:13px;color:#6b7280;">${inv.businessEmail}</div>
                        </td>
                        <td style="width:50%;padding-bottom:12px;">
                          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${isReceipt ? "Payment Date" : "Due Date"}</div>
                          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${fmtDate(inv.dueDate)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top:0;">
                          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Issued</div>
                          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${fmtDate(inv.createdAt)}</div>
                        </td>
                        <td></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Line items -->
          <tr>
            <td style="padding:0 32px 24px;">
              <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:10px;">Line Items</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Description</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Qty</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Unit Price</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
                <tfoot>
                  <tr style="background:#f9fafb;">
                    <td colspan="3" style="padding:12px;font-size:14px;font-weight:600;color:#1a1a1a;text-align:right;border-top:2px solid #e5e7eb;">Total</td>
                    <td style="padding:12px;font-size:16px;font-weight:800;color:#0D9E7E;text-align:right;border-top:2px solid #e5e7eb;">${fmtCurrency(inv.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          ${notes ? `
          <!-- Notes -->
          <tr>
            <td style="padding:0 32px 24px;">
              <div style="background:#f9fafb;border-radius:8px;padding:16px;">
                <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Notes</div>
                <div style="font-size:14px;color:#374151;line-height:1.5;">${notes}</div>
              </div>
            </td>
          </tr>` : ""}

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                This ${isReceipt ? "receipt" : "invoice"} was sent by <strong>ChargeBridge</strong> · Community-powered EV charging network
                <br />Questions? Reply to this email or visit <a href="https://chargebridge.app" style="color:#0D9E7E;">chargebridge.app</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
