import { useEffect, useRef, useState } from "react";
import { PrinterIcon as Printer } from "@phosphor-icons/react";
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

type ReceiptTemplate = {
  companyName: string;
  companyTagline: string;
  showLogo: boolean;
  docSubtitle: string;
  docTitle: string;
  footerHeading: string;
  remarks: string;
  note: string;
  footerNote: string;
};

const DEFAULT_TEMPLATE: ReceiptTemplate = {
  companyName: "ACTIVE PRO",
  companyTagline: "Bicycle Parts, Accessories & Wholesale Distribution",
  showLogo: true,
  docSubtitle: "DELIVERY DOCUMENT",
  docTitle: "DELIVERY RECEIPT",
  footerHeading: "PACKING LIST / ACKNOWLEDGEMENT",
  remarks: "",
  note: "",
  footerNote: "",
};

const DR_TEMPLATE_STORAGE_KEY = "activepro_dr_template";

const loadTemplate = (): ReceiptTemplate => {
  try {
    const raw = localStorage.getItem(DR_TEMPLATE_STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATE;
    const parsed = JSON.parse(raw);
    return {
      companyName: typeof parsed.companyName === "string" && parsed.companyName.trim() ? parsed.companyName : DEFAULT_TEMPLATE.companyName,
      companyTagline: typeof parsed.companyTagline === "string" ? parsed.companyTagline : DEFAULT_TEMPLATE.companyTagline,
      showLogo: typeof parsed.showLogo === "boolean" ? parsed.showLogo : DEFAULT_TEMPLATE.showLogo,
      docSubtitle: typeof parsed.docSubtitle === "string" && parsed.docSubtitle.trim() ? parsed.docSubtitle : DEFAULT_TEMPLATE.docSubtitle,
      docTitle: typeof parsed.docTitle === "string" && parsed.docTitle.trim() ? parsed.docTitle : DEFAULT_TEMPLATE.docTitle,
      footerHeading: typeof parsed.footerHeading === "string" && parsed.footerHeading.trim() ? parsed.footerHeading : DEFAULT_TEMPLATE.footerHeading,
      remarks: typeof parsed.remarks === "string" ? parsed.remarks : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
      footerNote: typeof parsed.footerNote === "string" ? parsed.footerNote : "",
    };
  } catch {
    return DEFAULT_TEMPLATE;
  }
};

const printStyles = `
  @page { size: A4 portrait; margin: 12mm; }
  .dr-page, .dr-page * { box-sizing: border-box; }
  .dr-page { width: 100%; background: white; color: #111827; padding: 28px; margin-bottom: 20px; font: 12px Arial, sans-serif; }
  .dr-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid #111827; padding-bottom: 16px; }
  .dr-heading > div { min-width: 0; overflow-wrap: anywhere; }
  .dr-brand { display: flex; align-items: center; gap: 12px; }
  .dr-brand-logo { width: 42px; height: 42px; object-fit: contain; border-radius: 6px; border: 1px solid #cbd5e1; background: #1c1f26; padding: 3px; }
  .dr-company-name { font-size: 14px; font-weight: 800; letter-spacing: 1.5px; color: #0f172a; margin: 0; }
  .dr-company-tagline { font-size: 10px; color: #475569; margin: 1px 0 6px; }
  .dr-heading h2 { margin: 2px 0 0; font-size: 22px; letter-spacing: 2px; }
  .dr-order-box { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 8px 12px; text-align: right; min-width: 190px; }
  .dr-muted { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  .dr-meta { display: grid; grid-template-columns: 1.6fr 1fr; gap: 8px 24px; padding: 14px 12px; margin: 14px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; }
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
  .dr-bottom-note { margin-top: 16px; padding-top: 10px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 11px; font-style: italic; font-weight: 600; color: #1e293b; white-space: pre-line; }
  .dr-page-number { margin-top: 20px; text-align: right; font-size: 10px; color: #64748b; }
  @media print { body { margin: 0; } .dr-page { padding: 0; margin: 0; break-after: page; } .dr-page:last-child { break-after: auto; } .dr-footer, .dr-totals, .dr-page tr { break-inside: avoid; } }
`;

const safeReceiptPhotoUrl = (rawUrl?: string): string | null => {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

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
  const printCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { printCleanupRef.current?.(); }, []);
  const [template, setTemplate] = useState<ReceiptTemplate>(() => loadTemplate());

  useEffect(() => {
    const syncTemplate = () => setTemplate(loadTemplate());
    syncTemplate();
    window.addEventListener("activepro_dr_template_changed", syncTemplate);
    window.addEventListener("storage", syncTemplate);
    return () => {
      window.removeEventListener("activepro_dr_template_changed", syncTemplate);
      window.removeEventListener("storage", syncTemplate);
    };
  }, [order?.id]);
  if (!order) return null;
  type Row = { item: ReceiptItem; number: number } | { discount: GroupDiscountResult };
  const rows: Row[] = items.flatMap((item, position) => [
    { item, number: position + 1 } as Row,
    ...(order.receiptDetails?.groupDiscounts || []).filter((d: GroupDiscountResult) => d.afterPosition === position).map((discount: GroupDiscountResult) => ({ discount })),
  ]);
  const pages = receiptPages(rows);
  const details = order.receiptDetails as (typeof order.receiptDetails & Partial<ReceiptTemplate>) | undefined;
  const displayCompanyName = details?.companyName || template.companyName || DEFAULT_TEMPLATE.companyName;
  const displayCompanyTagline = details?.companyTagline !== undefined ? details.companyTagline : template.companyTagline;
  const displayShowLogo = details?.showLogo !== undefined ? details.showLogo : template.showLogo;
  const displaySubtitle = details?.docSubtitle || template.docSubtitle || DEFAULT_TEMPLATE.docSubtitle;
  const displayTitle = details?.docTitle || template.docTitle || DEFAULT_TEMPLATE.docTitle;
  const displayFooterHeading = details?.footerHeading || template.footerHeading || DEFAULT_TEMPLATE.footerHeading;
  const displayRemarks = details?.remarks || template.remarks;
  const displayNote = details?.note || template.note;
  const displayFooterNote = details?.footerNote !== undefined ? details.footerNote : template.footerNote;
  const rawDate = order.createdAt?.toDate
    ? order.createdAt.toDate()
    : new Date(order.createdAt);
  const date = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : null;
  const safePhotoUrl = safeReceiptPhotoUrl(order.photoValidationUrl);
  const subtotal =
    details?.subtotal ?? items.reduce((sum, item) => sum + item.subtotal, 0);
  const groupDiscountTotal = (details?.groupDiscounts || []).reduce((sum: number, d: GroupDiscountResult) => sum + (d.amount || 0), 0);
  const orderDiscountPhp =
    details?.orderDiscount !== undefined
      ? details.orderDiscount
      : Math.max(0, (details?.discount || 0) - groupDiscountTotal);
  const logoSrc = `${typeof window !== "undefined" ? window.location.origin : ""}/logo.png`;
  const print = () => {
    printCleanupRef.current?.();
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
    let cleanupTimer = 0;
    let printTimer = 0;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.clearTimeout(cleanupTimer);
      window.clearTimeout(printTimer);
      frame.remove();
      if (printCleanupRef.current === cleanup) {
        printCleanupRef.current = null;
      }
    };
    printCleanupRef.current = cleanup;
    cleanupTimer = window.setTimeout(cleanup, 60_000);
    frame.contentWindow.addEventListener("afterprint", cleanup, {
      once: true,
    });
    printTimer = window.setTimeout(() => {
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
          <div ref={content} className="min-w-160">
            {pages.map((page, index) => (
              <section className="dr-page shadow-sm" key={index}>
                <div className="dr-heading">
                  <div className="dr-brand">
                    {displayShowLogo && (
                      <img src={logoSrc} alt={displayCompanyName} className="dr-brand-logo" />
                    )}
                    <div>
                      <p className="dr-company-name">{displayCompanyName}</p>
                      {displayCompanyTagline && (
                        <p className="dr-company-tagline">{displayCompanyTagline}</p>
                      )}
                      <div className="dr-muted">{displaySubtitle}</div>
                      <h2>{displayTitle}</h2>
                    </div>
                  </div>
                  <div className="dr-order-box">
                    <div className="dr-muted">DR / Order No.</div>
                    <strong style={{ fontSize: "14px", letterSpacing: "0.5px" }}>{order.orderNumber}</strong>
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "#334155" }}>
                      <b>Date:</b> {date ? date.toLocaleDateString("en-PH") : "—"}
                    </div>
                  </div>
                </div>
                <div className="dr-meta">
                  <div>
                    <b>Customer / Sold To:</b> {order.clientName}
                  </div>
                  <div>
                    <b>Payment Terms:</b> {details?.paymentTerms || "—"}
                  </div>
                  <div>
                    <b>Delivery Address:</b> {details?.address || "—"}
                  </div>
                  <div>
                    <b>Delivery Region:</b> {(order as any).deliveryRegion || "—"}
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
                        <td>{item.entryDetails?.unit || (item as any).entry_details?.unit || item.unit || (item as any).units || "pc"}</td>
                        <td>
                          {item.name}
                          {item.entryDetails?.variation
                            ? ` — ${item.entryDetails.variation}`
                            : ""}
                          {(item.locationAisle || item.locationBin) && (
                            <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px" }}>Loc: {item.locationAisle || "-"} / {item.locationBin || "-"}</div>
                          )}
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
                      {groupDiscountTotal > 0 && (
                        <div>
                          <span>Group Discounts</span>
                          <span>−{money(groupDiscountTotal)}</span>
                        </div>
                      )}
                      {orderDiscountPhp > 0 && (
                        <div>
                          <span>Order Discount</span>
                          <span>−{money(orderDiscountPhp)}</span>
                        </div>
                      )}
                      {groupDiscountTotal === 0 && orderDiscountPhp === 0 && !!details?.discount && (
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
                      <h3>{displayFooterHeading}</h3>
                      <div className="dr-signatures">
                        <div>
                          Prepared By
                          <br />
                          <br />
                          {details?.preparedBy || ""}
                        </div>
                        <div>
                          Dispatched By (Driver)
                          <br />
                          <br />
                          __________________
                        </div>
                        <div>
                          Received By (Client)
                          <br />
                          <br />
                          __________________
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
                        <div style={{ flex: 1 }}>
                          <p>
                            Arrival Time: __________________ &nbsp; Departure Time:
                            __________________
                          </p>
                          <p>
                            Remarks:{" "}
                            {displayRemarks
                              ? displayRemarks
                              : "__________________________________________________________________"}
                          </p>
                          <p>
                            Note:{" "}
                            {displayNote
                              ? displayNote
                              : "______________________________________________________________________"}
                          </p>
                        </div>
                        {safePhotoUrl && (
                          <div style={{ width: "120px", textAlign: "center" }}>
                            <p style={{ margin: "0 0 5px", fontSize: "10px", fontWeight: "bold" }}>Dispatch Photo</p>
                            <img src={safePhotoUrl} alt="Validation" style={{ width: "100%", height: "80px", objectFit: "cover", border: "1px solid #94a3b8" }} />
                          </div>
                        )}
                      </div>
                      {!!displayFooterNote?.trim() && (
                        <div className="dr-bottom-note">
                          NOTE: {displayFooterNote.trim()}
                        </div>
                      )}
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
