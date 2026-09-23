import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ClipboardList,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InventoryItem, Product, UserProfile, Warehouse } from "../types";
import { supabase } from "../lib/supabase";
import { collection, db, onSnapshot } from "../lib/supabaseAdapter";
import {
  existingCustomers,
  money,
  groupedOrderTotals,
  type GroupDiscount,
  priceLabels,
  productPrices,
  roundMoney,
  type CartLine,
  type ReceiptItem,
  type ReceiptOrder,
  type SellingPrice,
} from "../lib/orderEntry";

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";
type ItemDraft = {
  id?: string;
  product: Product;
  quantity: string;
  warehouseId: string;
  priceType: SellingPrice;
  customPrice: string;
};

export function OrderEntry({
  open,
  onClose,
  orders,
  products,
  inventory,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  orders: ReceiptOrder[];
  products: Product[];
  inventory: InventoryItem[];
  profile: UserProfile;
  onSaved: (order: ReceiptOrder, items: ReceiptItem[]) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const orderNumber = `ORD-${requestId.toUpperCase()}`;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseError, setWarehouseError] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState("Metro Manila");
  const [terms, setTerms] = useState("COD");
  const [customTerms, setCustomTerms] = useState("");
  const [mode, setMode] = useState<"select" | "sku" | "scan">("select");
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [discount, setDiscount] = useState("");
  const [groupDiscounts, setGroupDiscounts] = useState<GroupDiscount[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [itemError, setItemError] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const cameraSession = useRef(0);
  const saveLock = useRef(false);
  const customers = existingCustomers(orders);
  const customer = customers.find((item) => item.name === customerName);
  const totals = groupedOrderTotals(lines, groupDiscounts, Number(discount || 0));
  const removeLine = (id: string) => {
    setLines(items => items.filter(item => item.id !== id));
    setGroupDiscounts(items => items.filter(item => item.afterLineId !== id));
  };
  const filteredProducts = products.filter((p) =>
    `${p.name} ${p.sku}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeWarehouses = warehouses.filter((w) => w.active !== false);

  useEffect(
    () =>
      onSnapshot(
        collection(db, "warehouses"),
        (snap) => {
          setWarehouses(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Warehouse),
          );
          setWarehouseError(false);
        },
        () => setWarehouseError(true),
      ),
    [],
  );

  const stopCamera = () => {
    cameraSession.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setScanning(false);
  };
  useEffect(() => {
    stopCamera();
    return stopCamera;
  }, [mode, open]);

  const availableStock = (
    productId: string,
    warehouseId: string,
    excludingId?: string,
  ) =>
    inventory
      .filter((i) => i.productId === productId && i.warehouseId === warehouseId)
      .reduce((sum, i) => sum + Math.max(0, i.quantity), 0) -
    lines
      .filter(
        (i) =>
          i.productId === productId &&
          i.warehouseId === warehouseId &&
          i.id !== excludingId,
      )
      .reduce((sum, i) => sum + i.quantity, 0);

  const openItem = (product: Product, line?: CartLine) => {
    stopCamera();
    setItemError("");
    setDraft({
      id: line?.id,
      product,
      quantity: String(line?.quantity ?? 1),
      warehouseId:
        line?.warehouseId ||
        activeWarehouses.find((w) => availableStock(product.id, w.id) > 0)
          ?.id ||
        "",
      priceType: line?.priceType || "regular",
      customPrice: line?.priceType === "custom" ? String(line.unitPrice) : "",
    });
  };
  const addCode = (value: string) => {
    const product = products.find(
      (p) => p.sku.trim().toLowerCase() === value.trim().toLowerCase(),
    );
    if (!product) {
      toast.error("No product matches this SKU.");
      return false;
    }
    openItem(product);
    setCode("");
    return true;
  };
  const startCamera = async () => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      toast.info(
        "Camera scanning is unavailable in this browser. Use a scanner or enter a SKU below.",
      );
      return;
    }
    stopCamera();
    const session = cameraSession.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (session !== cameraSession.current || !video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (session !== cameraSession.current) return;
      setScanning(true);
      const detector = new Detector({
        formats: [
          "qr_code",
          "code_128",
          "code_39",
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
        ],
      });
      let lastUnknown = "";
      const scan = async () => {
        if (session !== cameraSession.current || !video.current) return;
        try {
          const codes = await detector.detect(video.current);
          if (session !== cameraSession.current) return;
          const value = codes[0]?.rawValue?.trim();
          if (value && value !== lastUnknown) {
            if (addCode(value)) return;
            lastUnknown = value;
          }
        } catch {
          /* Keep scanning after an unreadable frame. */
        }
        if (session === cameraSession.current)
          frame.current = requestAnimationFrame(scan);
      };
      frame.current = requestAnimationFrame(scan);
    } catch {
      stopCamera();
      toast.error(
        "Unable to access the camera. Check permission or enter the SKU.",
      );
    }
  };

  const draftPrices = draft ? productPrices(draft.product) : null;
  const draftPrice = draft
    ? draft.priceType === "custom"
      ? draft.customPrice === ""
        ? null
        : Number(draft.customPrice)
      : draftPrices![draft.priceType]
    : null;
  const draftStock = draft
    ? availableStock(draft.product.id, draft.warehouseId, draft.id)
    : 0;
  const saveItem = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !draftPrices) return;
    const quantity = Number(draft.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setItemError("Enter a whole quantity of at least 1.");
      return;
    }
    if (!activeWarehouses.some((w) => w.id === draft.warehouseId)) {
      setItemError("Choose an active source warehouse.");
      return;
    }
    if (quantity > draftStock) {
      setItemError(
        `Only ${Math.max(0, draftStock)} units are available at this warehouse after other cart items.`,
      );
      return;
    }
    if (draftPrice == null || !Number.isFinite(draftPrice) || draftPrice < 0) {
      setItemError(
        "Select an available selling price or enter a valid custom price.",
      );
      return;
    }
    const product = draft.product as Product & {
      variation?: string;
      unit?: string;
    };
    const line: CartLine = {
      id: draft.id || crypto.randomUUID(),
      productId: product.id,
      sku: product.sku,
      name: product.name,
      variation: product.variation || "",
      unit: product.unit || "pc",
      quantity,
      warehouseId: draft.warehouseId,
      priceType: draft.priceType,
      unitPrice: roundMoney(draftPrice),
      prices: draftPrices,
    };
    setLines((current) =>
      draft.id
        ? current.map((item) => (item.id === draft.id ? line : item))
        : [...current, line],
    );
    setDraft(null);
    setSaveError("");
  };
  const editLine = (line: CartLine) => {
    const product = products.find((p) => p.id === line.productId);
    if (product) openItem(product, line);
    else
      toast.error(
        "This product is no longer available. Remove it from the order.",
      );
  };
  const submit = async () => {
    if (
      saveLock.current ||
      !customer ||
      !lines.length ||
      !totals.valid ||
      (terms === "Custom" && !customTerms.trim())
    )
      return;
    saveLock.current = true;
    setSaving(true);
    setSaveError("");
    stopCamera();
    try {
      const { data, error } = await supabase.rpc("create_order_entry", {
        p_request_id: requestId,
        p_order: {
          customerSourceId: orders.find((o) => o.clientName === customer.name)
            ?.id,
          address: address.trim(),
          deliveryRegion: region,
          paymentTerms: terms === "Custom" ? customTerms.trim() : terms,
          discount: totals.discount,
          orderDiscount: Number(discount || 0),
          groupDiscounts: totals.groups,
          items: lines,
        },
      });
      if (error) throw error;
      if (
        !data?.order ||
        data.order.stockReserved !== true ||
        !Array.isArray(data.items)
      )
        throw new Error(
          "The save result could not be confirmed. Retry to check this order safely.",
        );
      toast.success("Order saved · stock reserved", {
        description: "Pending order created. Your delivery receipt is ready.",
      });
      onSaved(data.order, data.items);
    } catch (error: any) {
      const message = error?.message || "Unable to save this order.";
      setSaveError(
        message.includes("create_order_entry")
          ? "Order saving is not available yet. Apply the Order Entry database migration, then retry. Your cart is preserved."
          : `${message} Your cart is preserved; retry to confirm the save.`,
      );
    } finally {
      setSaving(false);
      saveLock.current = false;
    }
  };
  const totalsPanel = (
    <div className="space-y-2 text-sm tabular-nums">
      <div className="flex justify-between text-muted-foreground">
        <span>Subtotal</span>
        <span>{money(totals.subtotal)}</span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>Total discounts</span>
        <span>−{money(totals.discount || 0)}</span>
      </div>
      <div className="flex justify-between border-t pt-3 text-lg font-bold">
        <span>Grand total</span>
        <span>{money(totals.total)}</span>
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !saving) onClose();
      }}
    >
      <DialogContent className="w-[97vw] sm:max-w-7xl max-h-[94vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="border-b px-6 py-5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sales / New order
          </div>
          <DialogTitle className="text-2xl">Order Entry</DialogTitle>
          <DialogDescription>
            Select a customer, build your order, and generate a delivery
            receipt.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={saving} className="min-w-0">
          <div className="grid gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <section className="rounded-xl border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">01 · Order details</h3>
                  <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                    Pending on save
                  </span>
                </div>
                <div>
                  <Label htmlFor="entry-number">
                    Order Number · Auto-generated
                  </Label>
                  <Input
                    id="entry-number"
                    className="mt-1.5 font-mono text-xs bg-muted/40"
                    value={orderNumber}
                    readOnly
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Customer</Label>
                    <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            variant="outline"
                            className="w-full justify-between font-normal"
                          />
                        }
                        role="combobox"
                        aria-expanded={customerOpen}
                        aria-label="Select existing customer"
                      >
                        <span className="truncate">
                          {customer?.name || "Search existing customers"}
                        </span>
                        <ChevronDown className="size-4 shrink-0" />
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-2" align="start">
                        <Input
                          autoFocus
                          aria-label="Search customers"
                          placeholder="Search customer name…"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                        />
                        <div className="mt-2 max-h-60 overflow-y-auto">
                          {customers
                            .filter((c) =>
                              c.name
                                .toLowerCase()
                                .includes(customerSearch.toLowerCase()),
                            )
                            .map((c) => (
                              <button
                                key={c.name}
                                type="button"
                                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted"
                                onClick={() => {
                                  setCustomerName(c.name);
                                  setAddress(c.address);
                                  setRegion(
                                    [
                                      "Metro Manila",
                                      "Luzon",
                                      "Visayas",
                                      "Mindanao",
                                    ].includes(c.region)
                                      ? c.region
                                      : "Luzon",
                                  );
                                  setCustomerOpen(false);
                                }}
                              >
                                <span>{c.name}</span>
                                {customerName === c.name && (
                                  <Check className="size-4" />
                                )}
                              </button>
                            ))}
                          {!customers.filter((c) =>
                            c.name
                              .toLowerCase()
                              .includes(customerSearch.toLowerCase()),
                          ).length && (
                            <p className="p-3 text-sm text-muted-foreground">
                              No existing customers found in your accessible
                              orders.
                            </p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-terms">Payment Terms</Label>
                    <select
                      id="entry-terms"
                      className={selectClass}
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                    >
                      {["COD", "30 Days", "60 Days", "90 Days", "Custom"].map(
                        (t) => (
                          <option key={t}>{t}</option>
                        ),
                      )}
                    </select>
                  </div>
                  {terms === "Custom" && (
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label htmlFor="entry-custom-terms">
                        Custom payment terms
                      </Label>
                      <Input
                        id="entry-custom-terms"
                        value={customTerms}
                        maxLength={200}
                        onChange={(e) => setCustomTerms(e.target.value)}
                        placeholder="Enter agreed payment terms"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-region">Delivery Region</Label>
                    <select
                      id="entry-region"
                      className={selectClass}
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                    >
                      <option value="Metro Manila">
                        Metro Manila · 7 days
                      </option>
                      <option value="Luzon">Provincial Luzon · 14 days</option>
                      <option value="Visayas">Visayas · 14 days</option>
                      <option value="Mindanao">Mindanao · 14 days</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entry-address">Delivery address</Label>
                    <Input
                      id="entry-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      maxLength={300}
                      placeholder="Street, city, province"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Customers come from your existing order records. Delivery is
                  due {region === "Metro Manila" ? "7" : "14"} days after
                  saving.
                </p>
              </section>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">02 · Add products</h3>
                  <span className="text-xs text-muted-foreground">
                    Choose quantity, warehouse & price
                  </span>
                </div>
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {(
                    [
                      { id: "select", label: "Select products", icon: Search },
                      { id: "sku", label: "Enter SKU", icon: ClipboardList },
                      { id: "scan", label: "Scan code", icon: ScanBarcode },
                    ] as const
                  ).map((tab) => (
                    <Button
                      key={tab.id}
                      type="button"
                      size="sm"
                      className="flex-1 min-w-0 px-1 text-xs sm:px-2.5 [&_svg]:hidden sm:[&_svg]:block"
                      variant={mode === tab.id ? "default" : "ghost"}
                      aria-pressed={mode === tab.id}
                      onClick={() => setMode(tab.id)}
                    >
                      <tab.icon className="size-4" />
                      <span>{tab.label}</span>
                    </Button>
                  ))}
                </div>
                {warehouseError && (
                  <p role="alert" className="text-sm text-destructive">
                    Warehouses could not be loaded. Reload before adding items.
                  </p>
                )}
                {mode === "select" ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        aria-label="Search products by name or SKU"
                        placeholder="Search product name or SKU…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-[380px] overflow-y-auto rounded-xl border divide-y">
                      {filteredProducts.map((p) => {
                        const stock = activeWarehouses.reduce(
                          (sum, w) =>
                            sum + Math.max(0, availableStock(p.id, w.id)),
                          0,
                        );
                        return (
                          <div
                            key={p.id}
                            className="flex items-center gap-3 p-3 hover:bg-muted/30"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{p.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                <span className="font-mono">{p.sku}</span> ·{" "}
                                <span
                                  className={
                                    stock <= 0 ? "text-destructive" : ""
                                  }
                                >
                                  {stock > 0
                                    ? `${stock} available`
                                    : "Out of stock"}
                                </span>
                              </p>
                            </div>
                            <div className="hidden sm:block text-right text-xs text-muted-foreground">
                              Regular
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {money(p.basePrice)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={stock <= 0 || warehouseError}
                              onClick={() => openItem(p)}
                              aria-label={`Add ${p.name}`}
                            >
                              <Plus className="size-4" />
                              Add
                            </Button>
                          </div>
                        );
                      })}
                      {!filteredProducts.length && (
                        <div className="p-10 text-center text-sm text-muted-foreground">
                          No products match your search.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border p-4 space-y-4">
                    {mode === "scan" && (
                      <>
                        <div className="relative flex aspect-video max-h-56 items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
                          <video
                            ref={video}
                            muted
                            playsInline
                            className="h-full w-full object-cover"
                          />
                          {!scanning && (
                            <ScanBarcode className="absolute size-10 text-zinc-500" />
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={scanning ? stopCamera : startCamera}
                        >
                          <Camera className="size-4" />
                          {scanning ? "Stop camera" : "Start camera"}
                        </Button>
                      </>
                    )}
                    <Label htmlFor="entry-code">
                      {mode === "scan" ? "Scanner input / SKU" : "Product SKU"}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="entry-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCode(code);
                          }
                        }}
                        placeholder="Enter an exact SKU"
                      />
                      <Button
                        disabled={!code.trim() || warehouseError}
                        onClick={() => addCode(code)}
                      >
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Press Enter or Add to choose the quantity, source
                      warehouse, and selling price.
                    </p>
                  </div>
                )}
              </section>
            </div>
            <aside className="min-w-0 rounded-xl border bg-muted/25 p-4 space-y-4 lg:sticky lg:top-0 self-start">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold">
                  <ShoppingCart className="size-4" />
                  Current Cart
                </h3>
                <span className="rounded-full bg-background px-2 py-1 text-xs border">
                  {lines.length} items
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!lines.length}
                onClick={() => setReviewOpen(true)}
              >
                <ClipboardList className="size-4" />
                View Order List
              </Button>
              <div className="max-h-[330px] overflow-y-auto space-y-2">
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="rounded-lg border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{line.name}</p>
                        {line.variation && (
                          <p className="text-xs text-muted-foreground">
                            {line.variation}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {
                            warehouses.find((w) => w.id === line.warehouseId)
                              ?.name
                          }{" "}
                          · {priceLabels[line.priceType]}
                        </p>
                      </div>
                      <div className="flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${line.name}`}
                          onClick={() => editLine(line)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          aria-label={`Remove ${line.name}`}
                          onClick={() =>
                            removeLine(line.id)
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-between text-sm tabular-nums">
                      <span className="text-muted-foreground">
                        {line.quantity} × {money(line.unitPrice)}
                      </span>
                      <strong>
                        {money(roundMoney(line.quantity * line.unitPrice))}
                      </strong>
                    </div>
                  </div>
                ))}
                {!lines.length && (
                  <div className="py-12 text-center text-muted-foreground">
                    <ShoppingCart className="mx-auto mb-3 size-8 opacity-30" />
                    <p className="text-sm">Your cart is empty</p>
                    <p className="mt-1 text-xs">
                      Add a product to get started.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 border-t pt-4">
                <Label htmlFor="entry-discount">
                  Order discount (₱){" "}
                  <span className="font-normal text-muted-foreground">
                    · Optional
                  </span>
                </Label>
                <Input
                  id="entry-discount"
                  type="number"
                  min="0"
                  step="0.01"
                  max={totals.subtotal}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground">
                  Optional extra discount. Add group discounts in View Order List.
                </p>
                {!totals.valid && (
                  <p role="alert" className="text-xs text-destructive">
                    Check group discounts and the extra discount: discounts cannot exceed their applicable subtotal.
                  </p>
                )}
              </div>
              {totalsPanel}
              {saveError && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {saveError}
                </p>
              )}
              <Button
                className="w-full min-h-11"
                disabled={
                  saving ||
                  !customer ||
                  !lines.length ||
                  !totals.valid ||
                  (terms === "Custom" && !customTerms.trim())
                }
                onClick={submit}
              >
                {saving ? "Saving order…" : "Save Order & Generate DR"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Stock is checked again when you save.
              </p>
            </aside>
          </div>
        </fieldset>
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="w-[97vw] sm:max-w-7xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Order List{" "}
                <span className="text-muted-foreground font-normal">
                  · {lines.length} items
                </span>
              </DialogTitle>
              <DialogDescription>
                Highlighted cells show the selected selling price. Insert a discount after the last item in a group; it applies to items since the previous discount. Cost is reference only.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    {[
                      "#",
                      "Item",
                      "Qty",
                      "Regular",
                      "MM",
                      "Provincial",
                      "Promo",
                      "Cost",
                      "Amount",
                      "",
                    ].map((label, i) => (
                      <TableHead key={i} className={i > 1 ? "text-right" : ""}>
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <React.Fragment key={line.id}>
                    <TableRow>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="min-w-48">
                        <p className="font-medium">{line.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.sku}
                          {line.variation ? ` · ${line.variation}` : ""} ·{" "}
                          {
                            warehouses.find((w) => w.id === line.warehouseId)
                              ?.name
                          }
                        </p>
                        {line.priceType === "custom" && (
                          <p className="mt-1 text-xs font-semibold">
                            Custom Price: {money(line.unitPrice)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {line.quantity}
                      </TableCell>
                      {(
                        [
                          "regular",
                          "mm",
                          "provincial",
                          "promo",
                          "cost",
                        ] as const
                      ).map((key) => (
                        <TableCell
                          key={key}
                          className={`text-right whitespace-nowrap tabular-nums ${line.priceType === key ? "bg-emerald-500/10 font-bold text-emerald-700 dark:text-emerald-300" : key === "cost" ? "text-muted-foreground bg-muted/30" : ""}`}
                        >
                          {line.priceType === key && (
                            <Check className="inline size-3 mr-1" />
                          )}
                          {line.prices[key] == null
                            ? "—"
                            : money(line.prices[key]!)}
                          {line.priceType === key && (
                            <span className="sr-only">
                              {" "}
                              selected selling price
                            </span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold whitespace-nowrap">
                        {money(roundMoney(line.quantity * line.unitPrice))}
                      </TableCell>
                      <TableCell>
                        <div className="flex">
                          <Button variant="outline" size="sm" disabled={groupDiscounts.some(d => d.afterLineId === line.id)}
                            onClick={() => setGroupDiscounts(current => [...current, {afterLineId: line.id, type: "percent", value: 0}])}>+ Discount</Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${line.name}`}
                            onClick={() => editLine(line)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${line.name}`}
                            onClick={() =>
                              removeLine(line.id)
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {totals.groups.filter(d => d.afterLineId === line.id).map(d => (
                      <TableRow key={`discount-${line.id}`} className="bg-amber-50/70 dark:bg-amber-950/20">
                        <TableCell colSpan={3}>
                          <p className="font-semibold text-sm">Group discount</p>
                          <p className="text-xs text-muted-foreground">Items {d.startPosition + 1}–{d.afterPosition + 1} · {money(d.base)}</p>
                        </TableCell>
                        <TableCell colSpan={5}>
                          <div className="flex items-center gap-2">
                            <select aria-label={`Discount type after item ${index + 1}`} className={`${selectClass} max-w-36`} value={d.type}
                              onChange={e => setGroupDiscounts(current => current.map(item => item.afterLineId === line.id ? {...item, type: e.target.value as GroupDiscount["type"]} : item))}>
                              <option value="percent">Percentage (%)</option><option value="amount">Amount (PHP)</option>
                            </select>
                            <Input aria-label={`Discount value after item ${index + 1}`} className="w-28" type="number" min="0" max={d.type === "percent" ? 100 : d.base} step="0.01" value={Number.isNaN(d.value) ? "" : d.value}
                              onChange={e => setGroupDiscounts(current => current.map(item => item.afterLineId === line.id ? {...item, value: e.target.value === "" ? NaN : Number(e.target.value)} : item))}/>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">−{money(d.amount || 0)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" aria-label={`Remove discount after item ${index + 1}`} onClick={() => setGroupDiscounts(current => current.filter(item => item.afterLineId !== line.id))}><Trash2 className="size-4"/></Button></TableCell>
                      </TableRow>
                    ))}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!totals.valid && <p role="alert" className="text-sm text-destructive">Enter valid discounts. Percentages must be 0–100%; amounts cannot exceed their group subtotal, and total discounts cannot exceed the order subtotal.</p>}
            <div className="ml-auto w-full sm:w-80">{totalsPanel}</div>
            <div className="flex justify-end">
              <Button onClick={() => setReviewOpen(false)}>
                Back to order
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!draft}
          onOpenChange={(value) => {
            if (!value) setDraft(null);
          }}
        >
          <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{draft?.id ? "Edit Item" : "Add Item"}</DialogTitle>
              <DialogDescription>
                Set the quantity, source warehouse, and selling price for this
                line.
              </DialogDescription>
            </DialogHeader>
            {draft && (
              <form onSubmit={saveItem} className="space-y-5">
                <div className="rounded-xl bg-muted/50 p-4">
                  <p className="font-semibold">{draft.product.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {draft.product.sku}
                    {(draft.product as Product & { variation?: string })
                      .variation
                      ? ` · ${(draft.product as Product & { variation?: string }).variation}`
                      : ""}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="item-quantity">Quantity</Label>
                    <Input
                      autoFocus
                      id="item-quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={draft.quantity}
                      onChange={(e) =>
                        setDraft({ ...draft, quantity: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="item-warehouse">Source warehouse</Label>
                    <select
                      id="item-warehouse"
                      required
                      className={selectClass}
                      value={draft.warehouseId}
                      onChange={(e) =>
                        setDraft({ ...draft, warehouseId: e.target.value })
                      }
                    >
                      <option value="">Choose warehouse</option>
                      {activeWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ·{" "}
                          {Math.max(
                            0,
                            availableStock(draft.product.id, w.id, draft.id),
                          )}{" "}
                          available
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p
                  className={`rounded-lg px-3 py-2 text-sm ${draftStock > 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                >
                  Available stock: <strong>{Math.max(0, draftStock)}</strong>{" "}
                  <span className="text-xs">after other cart items</span>
                </p>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">
                    Selling price
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(priceLabels) as SellingPrice[]).map((key) => (
                      <label
                        key={key}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${draft.priceType === key ? "border-primary bg-primary/5 ring-1 ring-primary" : ""} ${key !== "custom" && draftPrices![key] == null ? "opacity-50" : ""}`}
                      >
                        <input
                          type="radio"
                          name="selling-price"
                          className="mt-1"
                          value={key}
                          checked={draft.priceType === key}
                          disabled={
                            key !== "custom" && draftPrices![key] == null
                          }
                          onChange={() =>
                            setDraft({ ...draft, priceType: key })
                          }
                        />
                        <span>
                          {priceLabels[key]}
                          <strong className="mt-1 block">
                            {key === "custom"
                              ? "Enter amount"
                              : draftPrices![key] == null
                                ? "Unavailable"
                                : money(draftPrices![key]!)}
                          </strong>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {draft.priceType === "custom" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="item-custom-price">
                      Custom unit price (₱)
                    </Label>
                    <Input
                      id="item-custom-price"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={draft.customPrice}
                      onChange={(e) =>
                        setDraft({ ...draft, customPrice: e.target.value })
                      }
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Cost:{" "}
                  {draftPrices?.cost == null
                    ? "Unavailable"
                    : money(draftPrices.cost)}{" "}
                  · Reference only
                </p>
                <div className="flex justify-between rounded-xl bg-muted p-4">
                  <span>Line amount</span>
                  <strong className="text-lg">
                    {money(
                      roundMoney(
                        (Number(draft.quantity) || 0) * (draftPrice || 0),
                      ),
                    )}
                  </strong>
                </div>
                {itemError && (
                  <p role="alert" className="text-sm text-destructive">
                    {itemError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {draft.id ? "Save changes" : "Add to order"}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
