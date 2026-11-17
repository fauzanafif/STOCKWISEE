<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Support\SchemaCache;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

/**
 * Converts between units, in decimal strings (bcmath), never floats. An item's own conversions come first;
 * otherwise the two units must be in one category, each with a fixed ratio to its reference.
 */
class UomConverter
{
    private const SCALE = 8;

    /** A number as a decimal string, whatever the driver or a cast handed over. */
    public static function dec(mixed $v): string
    {
        if ($v === null || $v === '') {
            return '0';
        }

        return is_string($v) && is_numeric($v) && ! str_contains(strtolower($v), 'e') ? $v : number_format((float) $v, self::SCALE, '.', '');
    }

    /** Half up to $scale decimals. */
    public static function roundDec(mixed $v, int $scale = 2): string
    {
        $v = self::dec($v);
        $half = bcdiv('5', bcpow('10', (string) ($scale + 1)), $scale + 1);

        return bcadd(bccomp($v, '0', self::SCALE) < 0 ? bcsub($v, $half, self::SCALE) : bcadd($v, $half, self::SCALE), '0', $scale);
    }

    /** What $qty of a document line is in the item's own unit; stock columns keep two decimals. */
    public static function baseQty(mixed $qty, mixed $ratio): string
    {
        return self::roundDec(bcmul(self::dec($qty), self::dec($ratio ?? '1'), self::SCALE), 2);
    }

    public static function isOne(mixed $ratio): bool
    {
        return bccomp(self::dec($ratio ?? '1'), '1', 6) === 0;
    }

    /**
     * What is set for this item, keyed by unit code: Accurate's (UNIT2/RATIO2, UNIT3/RATIO3, read only:
     * 1 UNIT2 = RATIO2 UNIT1) over the ones entered here.
     *
     * @return Collection<string, array{id:?int, unit_id:?int, code:string, ratio:float, ratio_decimal:string, source:string}>
     */
    public function itemConversions(Item $item, bool $withStale = false): Collection
    {
        $units = Unit::pluck('id', 'code');
        // a ratio set against another base unit than the item's of today is not used until it is reviewed
        $tracked = SchemaCache::hasColumn('item_unit_conversions', 'base_unit_id');
        // callers may have loaded only id and code: the item's unit is then read here
        $itemUnit = ! $tracked ? null : (array_key_exists('unit_id', $item->getAttributes()) ? $item->unit_id : Item::whereKey($item->id)->value('unit_id'));
        $out = ItemUnitConversion::with($tracked ? ['unit:id,code', 'baseUnit:id,code'] : ['unit:id,code'])->where('item_id', $item->id)->get()
            ->filter(fn ($c) => $withStale || ! ($tracked && $c->isStale($itemUnit)))
            ->mapWithKeys(fn ($c) => [$c->unit->code => ['id' => $c->id, 'unit_id' => $c->unit_id, 'code' => $c->unit->code, 'ratio' => (float) $c->ratio, 'ratio_decimal' => self::dec($c->ratio), 'source' => 'MANUAL']
                + ($withStale ? ['needs_review' => $tracked && $c->isStale($itemUnit), 'set_against' => $tracked ? $c->baseUnit?->code : null] : [])]);
        if (filled($item->code) && Schema::hasTable('accurate_item')) {
            $row = DB::table('accurate_item')->where('ITEMNO', $item->code)->first();
            foreach ([['UNIT2', 'RATIO2'], ['UNIT3', 'RATIO3']] as [$u, $r]) {
                $code = mb_strtoupper(trim((string) ($row->{$u} ?? '')));
                if ($code !== '' && bccomp(self::dec($row->{$r} ?? 0), '0', 6) > 0) {
                    $out[$code] = ['id' => null, 'unit_id' => $units[$code] ?? null, 'code' => $code, 'ratio' => (float) $row->{$r}, 'ratio_decimal' => self::dec($row->{$r}), 'source' => 'ACCURATE'];
                }
            }
        }

        return collect($out);
    }

    /** How many of $to one $from makes, as a decimal string. */
    public function factor(Unit $from, Unit $to, ?Item $item = null): string
    {
        if ($from->id === $to->id) {
            return '1';
        }
        if ($item) {
            $base = $item->unit;
            $own = $this->itemConversions($item);
            $a = $this->toItemUnit($from, $base, $own);
            $b = $this->toItemUnit($to, $base, $own);
            if ($a !== null && $b !== null) {
                return bcdiv($a, $b, self::SCALE);
            }
        }
        if (! $from->uom_category_id || $from->uom_category_id !== $to->uom_category_id) {
            throw ValidationException::withMessages(['to' => "{$from->code} dan {$to->code} beda kategori, jadi tidak bisa dikonversi".($item ? ' untuk barang ini.' : '. Pilih barangnya kalau rasionya ditetapkan per barang.')]);
        }
        if ($from->ratio === null || $to->ratio === null) {
            $varies = $from->ratio === null ? $from->code : $to->code;
            throw ValidationException::withMessages(['to' => "Isi {$varies} berbeda per barang. ".($item ? 'Tetapkan rasionya untuk barang ini.' : 'Pilih barangnya.')]);
        }

        return bcdiv(self::dec($from->ratio), self::dec($to->ratio), self::SCALE);
    }

    /** How many of the item's own unit one of this document unit is; 1 when there is nothing to convert. */
    public function documentRatio(?Item $item, ?Unit $unit): string
    {
        if (! $item || ! $unit || ! $item->unit_id || (int) $item->unit_id === (int) $unit->id) {
            return '1';
        }
        $item->setRelation('unit', Unit::find($item->unit_id)); // whole: callers may have loaded only id and code

        return self::roundDec($this->factor($unit, $item->unit, $item), 6);
    }

    /**
     * What a document line stores for a unit written as text: the ratio frozen at this moment and the item's
     * own unit. `known` is false when the text is no unit of the master, or the item has none: nothing is
     * guessed, the quantity counts as it is and the line is marked for mapping.
     *
     * @return array{unit_ratio:string, base_satuan:?string, known:bool}
     */
    public function snapshot(?Item $item, ?string $unitText, string $label, string $field): array
    {
        $code = mb_strtoupper(trim((string) $unitText));
        $unit = $code !== '' ? Unit::where('code', $code)->first() : null;
        if (! $item || ! $item->unit_id || ! $unit) {
            return ['unit_ratio' => '1', 'base_satuan' => null, 'known' => $code === '' && (bool) $item?->unit_id];
        }
        try {
            $ratio = $this->documentRatio($item, $unit);
        } catch (ValidationException $e) {
            throw ValidationException::withMessages([$field => "{$label}: ".collect($e->errors())->flatten()->first().' Atur di menu UOM, tab Per item.']);
        }

        return ['unit_ratio' => $ratio, 'base_satuan' => (int) $item->unit_id !== (int) $unit->id ? $item->unit?->code : null, 'known' => true];
    }

    /**
     * The units this item can be ordered in, each with how many of its own unit it is: its own unit,
     * the ones set for the item, and the fixed ones of its category.
     *
     * @return list<array{unit_id:int, code:string, ratio:float}>
     */
    public function orderUnits(Item $item): array
    {
        $base = $item->unit_id ? Unit::find($item->unit_id) : null;
        if (! $base) {
            return [];
        }
        $item->setRelation('unit', $base);
        $units = Unit::where('is_active', true)->where(fn ($q) => $q->where('id', $base->id)
            ->orWhereIn('code', $this->itemConversions($item)->keys()->all())
            ->orWhere(fn ($c) => $c->whereNotNull('ratio')->whereNotNull('uom_category_id')->where('uom_category_id', $base->uom_category_id ?? 0)))->orderBy('code')->get();

        return $units->map(fn (Unit $u) => ['unit_id' => $u->id, 'code' => $u->code, 'ratio' => (float) $this->documentRatio($item, $u)])->values()->all();
    }

    /** A quantity in this unit, on a multiple of the unit's rounding (halves go up). */
    public function roundTo(Unit $unit, mixed $qty): string
    {
        $step = bccomp(self::dec($unit->rounding), '0', 6) > 0 ? self::dec($unit->rounding) : '0.01';
        $steps = self::roundDec(bcdiv(self::dec($qty), $step, self::SCALE), 0);

        return self::roundDec(bcmul($steps, $step, self::SCALE), 6);
    }

    private function toItemUnit(Unit $unit, ?Unit $base, Collection $own): ?string
    {
        if ($base && $unit->id === $base->id) {
            return '1';
        }
        if (isset($own[$unit->code])) {
            return $own[$unit->code]['ratio_decimal'];
        }
        if ($base && $base->uom_category_id && $unit->uom_category_id === $base->uom_category_id && $unit->ratio !== null && $base->ratio !== null) {
            return bcdiv(self::dec($unit->ratio), self::dec($base->ratio), self::SCALE);
        }

        return null;
    }
}
