-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: Allow 'cancelled' in order_status & transfer_status Enums
--             + Add warehouseId to order_items
--  Run this in your Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add 'cancelled' to the order_status ENUM
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. Add 'cancelled' to the transfer_status ENUM
ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 3. Add warehouseId column to order_items table if missing
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
