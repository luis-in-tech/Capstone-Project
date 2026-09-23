import React, { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  money,
  receiptPages,
  type GroupDiscountResult,
  type ReceiptItem,
  type ReceiptOrder,
} from "../lib/orderEntry";

const printStyles = `
  @page { size: A4 portrait; margin: 12mm; }
  .dr-page, .dr-page * { box-sizing: border-box; }
  .dr-page { width: 100%; background: white; color: #111827; padding: 28px; margin-bottom: 20px; font: 12px Arial, sans-serif; }
  .dr-heading { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #111827; padding-bottom: 16px; }
  .dr-heading > div { min-width: 0; overflow-wrap: anywhere; }
  .dr-heading h2 { margin: 4px 0; font-size: 24px; letter-spacing: 2px; }
  .dr-muted { color: #64748b; font-size: 11px; }
  .dr-meta { display: grid; grid-template-columns: 2fr 1fr; gap: 10px 24px; padding: 20px 0; font-size: 12px; }
  .dr-meta div { overflow-wrap: anywhere; }
  .dr-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
  .dr-table th { background: #f1f5f9; text-align: left; border-block: 1px solid #94a3b8; padding: 9px 5px; }
  .dr-table td { padding: 9px 5px; border-bottom: 1px solid #e2e8f0; overflow-wrap: anywhere; vertical-align: top; }
  .dr-table .dr-right { text-align: right; }
  .dr-totals { margin: 20px 0 20px auto; width: 260px; font-size: 12px; }
  .dr-totals div { display: flex; justify-content: space-between; padding: 6px 0; }
  .dr-total { border-top: 2px solid #111827; font-size: 15px; font-weight: bold; }
  .dr-footer { border: 1px solid #94a3b8; padding: 14px; margin-top: 24px; font-size: 11px; }
  .dr-footer h3 { margin: 0 0 20px; font-size: 12px; letter-spacing: 1px; }
  .dr-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .dr-signatures div { border-bottom: 1px solid #94a3b8; min-height: 48px; }
  .dr-footer p { margin-top: 20px; }
  .dr-page-number { margin-top: 20px; text-align: right; font-size: 10px; color: #64748b; }
  @media print { body { margin: 0; } .dr-page { padding: 0; margin: 0; break-after: page; } .dr-page:last-child { break-after: auto; } .dr-footer, .dr-totals, .dr-page tr { break-inside: avoid; } }
`;

export function DeliveryReceipt({
  order,
  items,
  onClose,
}: {
  order: ReceiptOrder | null;
  items: ReceiptItem[];
  onClose: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  if (!order) return null;
  type Row = { item: ReceiptItem; number: number } | { discount: GroupDiscountResult };
  const rows: Row[] = items.flatMap((item, position) => [
    { item, number: position + 1 } as Row,
    ...(order.receiptDetails?.groupDiscounts || []).filter(d => d.afterPosition === position).map(discount => ({ discount })),
  ]);
  const pages = receiptPages(rows);
  const details = order.receiptDetails;
  const date = order.createdAt?.toDate
    ? order.createdAt.toDate()
    : new Date(order.createdAt);
  const subtotal =
    details?.subtotal ?? items.reduce((sum, item) => sum + item.subtotal, 0);
  const print = () => {
    // Clone only the receipt into an isolated document so app dialogs never appear in print.
    const frame = document.createElement("iframe");
    frame.title = "Delivery receipt print document";
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow || !content.current) {
      frame.remove();
      return;
    }
    const style = doc.createElement("style");
    style.textContent = printStyles;
    doc.head.appendChild(style);
    doc.title = `Delivery Receipt ${order.orderNumber}`;
    doc.body.appendChild(content.current.cloneNode(true));
    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {
      once: true,
    });
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 250);
  };
  return (
    <Dialog
      open={!!order}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[96vw] sm:max-w-4xl max-h-[94vh] overflow-y-auto bg-muted">
        <DialogHeader>
          <DialogTitle>Delivery Receipt</DialogTitle>
          <DialogDescription>
            {order.orderNumber} · {pages.length}{" "}
            {pages.length === 1 ? "page" : "pages"} · Ready to print or save as
            PDF
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button onClick={print}>
            <Printer className="size-4" />
            Print / Save PDF
          </Button>
        </div>
        <style>{printStyles}</style>
        <div className="overflow-x-auto">
          <div ref={content} className="min-w-[640px]">
            {pages.map((page, index) => (
              <section className="dr-page shadow-sm" key={index}>
                <div className="dr-heading">
                  <div>
                    <div className="dr-muted">DELIVERY DOCUMENT</div>
                    <h2>DELIVERY RECEIPT</h2>
                  </div>
                  <div>
                    <div className="dr-muted">Order Number</div>
                    <strong>{order.orderNumber}</strong>
                  </div>
                </div>
                <div className="dr-meta">
                  <div>
                    <b>Customer Name:</b> {order.clientName}
                  </div>
                  <div>
                    <b>Date:</b> {date.toLocaleDateString("en-PH")}
                  </div>
                  <div>
                    <b>Address:</b> {details?.address || "—"}
                  </div>
                  <div>
                    <b>Payment Terms:</b> {details?.paymentTerms || "—"}
                  </div>
                </div>
                <table className="dr-table">
                  <colgroup>
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "43%" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "17%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Description</th>
                      <th className="dr-right">Unit Price</th>
                      <th className="dr-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((entry) => "discount" in entry ? (
                      <tr key={`discount-${entry.discount.afterPosition}`} style={{ background: "#fffbeb" }}>
                        <td colSpan={5}>Discount · Items {entry.discount.startPosition + 1}–{entry.discount.afterPosition + 1}{entry.discount.type === "percent" ? ` (${entry.discount.value}%)` : ""}</td>
                        <td className="dr-right">−{money(entry.discount.amount)}</td>
                      </tr>
                    ) : (() => { const item = entry.item; return (
                      <tr key={item.id}>
                        <td>{entry.number}</td>
                        <td>{item.quantity}</td>
                        <td>{item.entryDetails?.unit || "pc"}</td>
                        <td>
                          {item.name}
                          {item.entryDetails?.variation
                            ? ` — ${item.entryDetails.variation}`
                            : ""}
                        </td>
                        <td className="dr-right">{money(item.unitPrice)}</td>
                        <td className="dr-right">{money(item.subtotal)}</td>
                      </tr>
                    ); })())}
                  </tbody>
                </table>
                {index === pages.length - 1 ? (
                  <>
                    <div className="dr-totals">
                      <div>
                        <span>Subtotal</span>
                        <span>{money(subtotal)}</span>
                      </div>
                      {!!details?.discount && (
                        <div>
                          <span>Total Discounts</span>
                          <span>−{money(details.discount)}</span>
                        </div>
                      )}
                      <div className="dr-total">
                        <span>Grand Total</span>
                        <span>{money(order.totalAmount)}</span>
                      </div>
                    </div>
                    <footer className="dr-footer">
                      <h3>PACKING LIST / ACKNOWLEDGEMENT</h3>
                      <div className="dr-signatures">
                        <div>
                          Prepared By
                          <br />
                          <br />
                          {details?.preparedBy || ""}
                        </div>
                        <div>Checked By</div>
                        <div>Received By</div>
                      </div>
                      <p>
                        Arrival Time: __________________ &nbsp; Departure Time:
                        __________________
                      </p>
                      <p>
                        Remarks:
                        __________________________________________________________________
                      </p>
                      <p>
                        Note:
                        ______________________________________________________________________
                      </p>
                    </footer>
                  </>
                ) : (
                  <p className="dr-muted" style={{ marginTop: 20 }}>
                    Continued on the next page. Order totals and acknowledgement
                    appear on the final page.
                  </p>
                )}
                <div className="dr-page-number">
                  Page {index + 1} / {pages.length}
                </div>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
