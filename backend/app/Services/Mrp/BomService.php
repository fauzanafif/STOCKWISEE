<?php

namespace App\Services\Mrp;

use App\Models\Item;
use App\Models\MrpBom;
use App\Models\MrpProduction;
use App\Models\Unit;
use App\Models\User;
use App\Services\DocumentNumberService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Bill of Materials.
 *   DRAFT    editable, may be deleted while no MO uses it
 *   ACTIVE   the one revision new MOs of the product use (activating one archives the previous)
 *   ARCHIVED kept for history; MOs made from it keep their own copy anyway
 * Component quantities are per 1 finished product, in each component's Base UOM. A product may not
 * contain itself, directly or through other BoMs.
 */
class BomService
{
    public const MAX_LINES = 200;

    public function __construct(private readonly DocumentNumberService $numbers) {}

    /**
     * @param  array{item_id:int, name?:?string, effective_date?:?string, notes?:?string, lines:list<array{item_id:int, qty:mixed, note?:?string}>}  $data
     */
    public function create(User $user, array $data): MrpBom
    {
        $product = $this->product((int) $data['item_id']);
        $lines = $this->lines($product, $data['lines'] ?? []);
        $this->assertNoCycle($product->id, array_column($lines, 'item_id'), null);

        return DB::transaction(function () use ($user, $data, $product, $lines) {
            $revision = (int) MrpBom::where('item_id', $product->id)->lockForUpdate()->max('revision') + 1;
            $bom = MrpBom::create([
                'code' => $this->numbers->nextShort('BOM'),
                'item_id' => $product->id,
                'revision' => $revision,
                'name' => $this->text($data['name'] ?? null) ?? $product->description,
                'status' => 'DRAFT',
                'base_unit' => $product->unit?->code,
                'effective_date' => $data['effective_date'] ?? null,
                'notes' => $this->text($data['notes'] ?? null),
                'created_by' => $user->id,
            ]);
            $this->writeLines($bom, $lines);
            MrpLog::write($bom, 'CREATED', $user, null, 'DRAFT', "Revisi {$revision}");

            return $bom->refresh();
        });
    }

    /** Only a draft changes; the product stays (a different product is a different BoM). */
    public function update(MrpBom $bom, User $user, array $data): MrpBom
    {
        $this->assertStatus($bom, ['DRAFT'], 'Hanya BoM draft yang bisa diubah. Buat revisi baru untuk mengubah BoM aktif.');
        $product = $this->product($bom->item_id);
        $lines = array_key_exists('lines', $data) ? $this->lines($product, $data['lines'] ?? []) : null;
        if ($lines !== null) {
            $this->assertNoCycle($product->id, array_column($lines, 'item_id'), $bom->id);
        }

        return DB::transaction(function () use ($bom, $user, $data, $lines) {
            $bom->update([
                'name' => array_key_exists('name', $data) ? ($this->text($data['name']) ?? $bom->name) : $bom->name,
                'effective_date' => array_key_exists('effective_date', $data) ? $data['effective_date'] : $bom->effective_date,
                'notes' => array_key_exists('notes', $data) ? $this->text($data['notes']) : $bom->notes,
            ]);
            if ($lines !== null) {
                $bom->lines()->delete();
                $this->writeLines($bom, $lines);
            }
            MrpLog::write($bom, 'UPDATED', $user);

            return $bom->refresh();
        });
    }

    /** Draft → Active; the product's previous active revision is archived in the same transaction. */
    public function activate(MrpBom $bom, User $user): MrpBom
    {
        return DB::transaction(function () use ($bom, $user) {
            $bom = MrpBom::lockForUpdate()->findOrFail($bom->id);
            $this->assertStatus($bom, ['DRAFT'], 'Hanya BoM draft yang bisa diaktifkan.');
            $product = $this->product($bom->item_id);
            $lines = $bom->lines()->get();
            if ($lines->isEmpty()) {
                throw ValidationException::withMessages(['lines' => 'BoM belum punya komponen.']);
            }
            // components may have changed since the draft was saved (an item turned into a service, lost its unit …)
            $this->lines($product, $lines->map(fn ($l) => ['item_id' => $l->item_id, 'qty' => $l->qty, 'note' => $l->note])->all());
            $this->assertNoCycle($product->id, $lines->pluck('item_id')->all(), $bom->id);

            foreach (MrpBom::where('item_id', $bom->item_id)->where('status', 'ACTIVE')->where('id', '!=', $bom->id)->lockForUpdate()->get() as $old) {
                $old->update(['status' => 'ARCHIVED', 'archived_at' => now(), 'archived_by' => $user->id]);
                MrpLog::write($old, 'ARCHIVED', $user, 'ACTIVE', 'ARCHIVED', "Digantikan {$bom->code} (revisi {$bom->revision})");
            }
            $bom->update(['status' => 'ACTIVE', 'activated_at' => now(), 'activated_by' => $user->id]);
            MrpLog::write($bom, 'ACTIVATED', $user, 'DRAFT', 'ACTIVE');

            return $bom->refresh();
        });
    }

    public function archive(MrpBom $bom, User $user): MrpBom
    {
        return DB::transaction(function () use ($bom, $user) {
            $bom = MrpBom::lockForUpdate()->findOrFail($bom->id);
            $this->assertStatus($bom, ['ACTIVE'], 'Hanya BoM aktif yang bisa diarsipkan. BoM draft cukup dihapus.');
            $bom->update(['status' => 'ARCHIVED', 'archived_at' => now(), 'archived_by' => $user->id]);
            MrpLog::write($bom, 'ARCHIVED', $user, 'ACTIVE', 'ARCHIVED');

            return $bom->refresh();
        });
    }

    /** A new draft revision copied from this one (any status); the original is untouched. */
    public function revise(MrpBom $bom, User $user): MrpBom
    {
        $copy = $this->create($user, [
            'item_id' => $bom->item_id, 'name' => $bom->name, 'notes' => $bom->notes, 'effective_date' => null,
            'lines' => $bom->lines()->get()->map(fn ($l) => ['item_id' => $l->item_id, 'qty' => MrpQty::show($l->qty), 'note' => $l->note])->all(),
        ]);
        MrpLog::write($copy, 'REVISED_FROM', $user, null, null, "Disalin dari {$bom->code} (revisi {$bom->revision})");

        return $copy;
    }

    public function delete(MrpBom $bom, User $user): void
    {
        $this->assertStatus($bom, ['DRAFT'], 'Hanya BoM draft yang bisa dihapus. BoM aktif diarsipkan.');
        if (MrpProduction::where('mrp_bom_id', $bom->id)->exists()) {
            throw ValidationException::withMessages(['bom' => 'BoM ini sudah dipakai Manufacturing Order.']);
        }
        DB::transaction(function () use ($bom, $user) {
            MrpLog::write($bom, 'DELETED', $user, 'DRAFT', null);
            $bom->delete();
        });
    }

    /** The active revision of a product, if any. */
    public static function activeFor(int $itemId): ?MrpBom
    {
        return MrpBom::where('item_id', $itemId)->where('status', 'ACTIVE')->orderByDesc('revision')->first();
    }

    // ------------------------------------------------------------------ validation

    private function product(int $itemId): Item
    {
        $item = Item::find($itemId);
        if (! $item || ! $item->is_active) {
            throw ValidationException::withMessages(['item_id' => 'Produk jadi tidak ditemukan atau tidak aktif.']);
        }
        if ($item->product_kind === 'JASA') {
            throw ValidationException::withMessages(['item_id' => 'Jasa tidak punya stok, jadi tidak bisa diproduksi.']);
        }
        if (! $item->unit_id) {
            throw ValidationException::withMessages(['item_id' => "{$item->code} belum punya Base UOM. Atur dulu di menu UOM."]);
        }
        $item->setRelation('unit', Unit::find($item->unit_id));

        return $item;
    }

    /** @return list<array{item_id:int, qty:string, base_unit:?string, note:?string}> */
    private function lines(Item $product, array $raw): array
    {
        if ($raw === []) {
            throw ValidationException::withMessages(['lines' => 'Tambahkan minimal satu komponen.']);
        }
        if (count($raw) > self::MAX_LINES) {
            throw ValidationException::withMessages(['lines' => 'Paling banyak '.self::MAX_LINES.' komponen.']);
        }
        $items = Item::whereIn('id', collect($raw)->pluck('item_id')->filter()->all())->get()->keyBy('id');
        $units = Unit::whereIn('id', $items->pluck('unit_id')->filter()->all())->pluck('code', 'id');
        $seen = [];
        $out = [];
        foreach (array_values($raw) as $i => $l) {
            $field = "lines.{$i}.item_id";
            $item = $items->get((int) ($l['item_id'] ?? 0));
            if (! $item || ! $item->is_active) {
                throw ValidationException::withMessages([$field => 'Komponen baris '.($i + 1).' tidak ditemukan atau tidak aktif.']);
            }
            if ((int) $item->id === (int) $product->id) {
                throw ValidationException::withMessages([$field => "{$item->code} adalah produk jadinya sendiri — tidak bisa menjadi komponen."]);
            }
            if ($item->product_kind === 'JASA') {
                throw ValidationException::withMessages([$field => "{$item->code} adalah jasa (tanpa stok), bukan komponen."]);
            }
            if (! $item->unit_id) {
                throw ValidationException::withMessages([$field => "{$item->code} belum punya Base UOM. Atur dulu di menu UOM."]);
            }
            if (isset($seen[$item->id])) {
                throw ValidationException::withMessages([$field => "{$item->code} tercantum dua kali. Gabungkan jumlahnya di satu baris."]);
            }
            $seen[$item->id] = true;
            $out[] = [
                'item_id' => $item->id,
                'qty' => MrpQty::positive($l['qty'] ?? null, "lines.{$i}.qty", MrpQty::SCALE, "Jumlah {$item->code}"),
                'base_unit' => $units[$item->unit_id] ?? null,
                'note' => $this->text($l['note'] ?? null, 255),
            ];
        }

        return $out;
    }

    /**
     * Refuses when the product can be reached from one of its components through the BoMs in use
     * (draft or active, archived ones make no new MO): A → B → … → A.
     */
    private function assertNoCycle(int $productId, array $componentIds, ?int $ignoreBomId): void
    {
        $graph = [];
        DB::table('mrp_bom_lines as l')->join('mrp_boms as b', 'b.id', '=', 'l.mrp_bom_id')
            ->whereIn('b.status', ['DRAFT', 'ACTIVE'])
            ->when($ignoreBomId, fn ($q) => $q->where('b.id', '!=', $ignoreBomId))
            ->get(['b.item_id as parent', 'l.item_id as child'])
            ->each(function ($r) use (&$graph) {
                $graph[(int) $r->parent][] = (int) $r->child;
            });
        $graph[$productId] = array_map('intval', $componentIds);

        $stack = [[$productId, [$productId]]];
        $visited = [];
        while ($stack) {
            [$node, $path] = array_pop($stack);
            foreach ($graph[$node] ?? [] as $child) {
                if ($child === $productId) {
                    $codes = Item::whereIn('id', array_merge($path, [$child]))->pluck('code', 'id');
                    $chain = implode(' → ', array_map(fn ($id) => $codes[$id] ?? "#{$id}", array_merge($path, [$child])));
                    throw ValidationException::withMessages(['lines' => "BoM melingkar: {$chain}. Produk tidak boleh menjadi komponen dirinya sendiri."]);
                }
                if (! isset($visited[$child])) {
                    $visited[$child] = true;
                    $stack[] = [$child, array_merge($path, [$child])];
                }
            }
        }
    }

    private function writeLines(MrpBom $bom, array $lines): void
    {
        foreach ($lines as $i => $l) {
            $bom->lines()->create($l + ['sort' => $i]);
        }
    }

    private function assertStatus(MrpBom $bom, array $allowed, string $message): void
    {
        if (! in_array($bom->status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => $message]);
        }
    }

    private function text(mixed $v, int $max = 2000): ?string
    {
        $s = trim((string) ($v ?? ''));

        return $s === '' ? null : mb_substr($s, 0, $max);
    }
}
