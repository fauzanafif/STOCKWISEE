<?php

namespace App\Http\Resources;

use App\Models\Item;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Item */
class ItemResource extends JsonResource
{
    /** item => its stock and approved incoming (prime()); per model instance, so never stale across requests */
    private static ?\WeakMap $primed = null;

    /** A page of items: their stock and approved incoming PPB / PO in a few queries, not one set per item. */
    public static function prime(iterable $items): void
    {
        $items = collect($items)->filter(fn ($i) => $i instanceof Item && $i->id);
        $ids = $items->pluck('id')->unique()->values()->all();
        if ($ids === []) {
            return;
        }
        self::$primed ??= new \WeakMap();
        $stock = \App\Models\Inventory::whereIn('item_id', $ids)->groupBy('item_id')->selectRaw('item_id, SUM(actual_qty) a')->pluck('a', 'item_id');
        $incoming = \App\Services\Inventory\OnOrder::approvedByItem($ids);
        foreach ($items as $item) {
            self::$primed[$item] = ['stock' => isset($stock[$item->id]) ? round(max(0.0, (float) $stock[$item->id]), 2) : null, 'incoming' => $incoming[$item->id] ?? null];
        }
    }

    private static function primedOf(Item $item): array
    {
        if (! $item->id) {
            return ['stock' => null, 'incoming' => null];
        }
        if (! isset(self::$primed[$item])) {
            self::prime([$item]);
        }

        return self::$primed[$item];
    }

    private static function stockOf(Item $item): float
    {
        return self::primedOf($item)['stock'] ?? round(max(0.0, (float) ($item->accurate_qty_onhand ?? 0)), 2);
    }

    private static function incomingOf(Item $item): array
    {
        return self::primedOf($item)['incoming'] ?? ['ppb' => 0.0, 'po' => 0.0, 'total' => 0.0, 'docs' => []];
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'description' => $this->description,
            'item_type' => $this->item_type,
            // BARANG / JASA (Master Produk)
            'product_kind' => $this->product_kind ?? 'BARANG',
            'needs_blueprint' => $this->needs_blueprint,
            // Accurate Item.MANAGESN: goes in / out one serial number per unit
            'manage_sn' => (bool) $this->manage_sn,
            'lead_time_days' => $this->lead_time_days,
            'is_active' => $this->is_active,
            'source' => $this->source,
            'accurate_synced_at' => $this->accurate_synced_at,
            'accurate_qty_onhand' => $this->accurate_qty_onhand,
            'accurate_qty_onorder' => $this->accurate_qty_onorder,
            // QTY = the warehouse stock in STOCKWISE (Accurate's + STOCKWISE's RI / NPBG); Accurate's when not tracked yet
            'stock_qty' => $stock = self::stockOf($this->resource),
            // what is coming in and approved: PPB DISETUJUI without PO, approved / sent POs not received yet
            'incoming' => $incoming = self::incomingOf($this->resource),
            // Forecast = QTY + incoming; an RI moves it from incoming into QTY
            'forecast_qty' => round($stock + $incoming['total'], 2),
            'category' => $this->whenLoaded('category', fn () => $this->category ? [
                'id' => $this->category->id,
                'name' => $this->category->name,
                'path' => $this->category->path,
            ] : null),
            // Kategori Anak 1/2/3 barang: diturunkan dari ITEMDESCRIPTION milik
            // rantai PARENTITEM Accurate (kolom accurate_category_anak_*, diisi
            // oleh AccurateSyncService), BUKAN dari tree kategori Excel
            // (`categories`/category_id — itu masih ada, dipakai fitur lain,
            // lihat field `category` di atas). Kategori Induk BUKAN dari rantai
            // PARENTITEM (level itu selalu null di data Accurate perusahaan
            // ini) — diturunkan dari 3 huruf depan kode barang lewat tabel
            // terjemahan tetap, lihat AccurateSyncService::KATEGORI_INDUK_MAP.
            'category_breakdown' => [
                'induk' => $this->accurate_category_induk,
                'anak_1' => $this->accurate_category_anak_1,
                'anak_2' => $this->accurate_category_anak_2,
                'anak_3' => $this->accurate_category_anak_3,
            ],
            'unit' => $this->whenLoaded('unit', fn () => $this->unit?->only('id', 'code', 'name')),
            'default_warehouse_id' => $this->default_warehouse_id,
            'default_warehouse' => $this->whenLoaded('defaultWarehouse', fn () => $this->defaultWarehouse?->only('id', 'code', 'name')),
            'default_location_id' => $this->default_location_id,
            'default_location' => $this->whenLoaded('defaultLocation', fn () => $this->defaultLocation?->only('id', 'code')),
            'blueprint_img_path' => $this->blueprint_img_path,
            'blueprint_pdf_path' => $this->blueprint_pdf_path,
            'blueprint_3d_ref' => $this->blueprint_3d_ref,
            // Excel lama: kolom "Nama Alias" bukan alias sungguhan (selalu "Tidak" — lihat
            // docs/excel-data-mapping.md §DATA.xlsx col 8). Alias asli ada di item_aliases.
            'alias_name' => 'Tidak',
            'aliases' => $this->whenLoaded('aliases', fn () => $this->aliases->pluck('alias_description')),
            'safety_stock' => $this->whenLoaded('effectiveSafetyStock', fn () => $this->effectiveSafetyStock?->safety_stock),
            'min_pr' => $this->whenLoaded('effectiveSafetyStock', fn () => $this->effectiveSafetyStock?->min_pr),
            'analysis' => $this->whenLoaded('snapshot', fn () => $this->snapshot ? [
                'actual' => $this->snapshot->actual,
                'reserved' => $this->snapshot->reserved,
                'available' => $this->snapshot->available,
                'stock_known' => $this->snapshot->stock_known,
                'safety_stock' => $this->snapshot->safety_stock,
                'selisih' => $this->snapshot->selisih,
                'status' => $this->snapshot->status,
                'deficit' => $this->snapshot->deficit,
                'priority_score' => $this->snapshot->priority_score,
                'priority_level' => $this->snapshot->priority_level,
                'recommendation' => $this->snapshot->recommendation,
                'recommended_qty' => $this->snapshot->recommended_qty,
            ] : null),
            'inventory' => $this->whenLoaded('inventory', fn () => $this->inventory->map(fn ($i) => [
                'warehouse_id' => $i->warehouse_id,
                'actual_qty' => $i->actual_qty,
                'reserved_qty' => $i->reserved_qty,
                'available_qty' => $i->available_qty,
                'stock_known' => $i->stock_known,
            ])),
        ];
    }
}
